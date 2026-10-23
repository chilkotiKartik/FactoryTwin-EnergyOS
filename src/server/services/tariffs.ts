import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db/client";
import { recommendations, tariffPeriods, tariffVersions, users } from "@/db/schema";
import { rateAt, validatePeriods, type TariffPeriod } from "@/domain/tariff";
import { hhmmToMinute, localToUtc } from "@/domain/time";
import type { Actor } from "../context";
import { requirePerm } from "../context";
import { audit } from "../audit";
import { validation } from "../errors";
import { newId } from "../ids";
import { loadTariffVersions } from "./common";

export async function listTariffVersions(db: DB, actor: Actor) {
  requirePerm(actor, "view");
  const [versions, meta] = await Promise.all([
    loadTariffVersions(db, actor.factory.id),
    db
      .select({ id: tariffVersions.id, evidence: tariffVersions.evidence, sourceNote: tariffVersions.sourceNote, createdAt: tariffVersions.createdAt, by: users.name })
      .from(tariffVersions)
      .leftJoin(users, eq(users.id, tariffVersions.createdBy))
      .where(eq(tariffVersions.factoryId, actor.factory.id)),
  ]);
  return versions
    .map((v) => ({ ...v, ...meta.find((m) => m.id === v.id)! }))
    .sort((a, b) => b.version - a.version);
}

const rupees = z.number().positive("Rate must be above zero.").max(100, "Rate above ₹100/kWh is not plausible.");

export const tariffInputSchema = z.object({
  name: z.string().trim().min(3).max(80),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Use a date and time."),
  normalRate: rupees,
  evidence: z.enum(["ASSUMPTION", "VERIFIED"]),
  sourceNote: z.string().trim().max(400).default(""),
  periods: z
    .array(
      z.object({
        kind: z.enum(["PEAK", "SOLAR", "OFFPEAK"]),
        label: z.string().trim().min(1).max(40),
        start: z.string(),
        end: z.string(),
        rate: rupees,
      }),
    )
    .max(8),
});

export async function createTariffVersion(db: DB, actor: Actor, raw: unknown) {
  requirePerm(actor, "tariff.write");
  const parsed = tariffInputSchema.safeParse(raw);
  if (!parsed.success) throw validation(parsed.error.issues[0]?.message ?? "Invalid tariff.");
  const input = parsed.data;
  if (input.evidence === "VERIFIED" && input.sourceNote.length < 10) {
    throw validation("A VERIFIED tariff needs a source (tariff order name, clause or URL).", { sourceNote: "Source required" });
  }
  const periods: TariffPeriod[] = [];
  for (const [i, p] of input.periods.entries()) {
    const s = hhmmToMinute(p.start);
    const e = hhmmToMinute(p.end);
    if (s === null || e === null) throw validation(`Window ${i + 1}: use HH:MM times.`);
    periods.push({ kind: p.kind, label: p.label, startMin: s % 1440, endMin: e === 0 ? 1440 : e, ratePaise: Math.round(p.rate * 100) });
  }
  const normalRatePaise = Math.round(input.normalRate * 100);
  const issues = validatePeriods(normalRatePaise, periods);
  if (issues.length) throw validation(issues[0].message);
  const [d, t] = input.effectiveFrom.split("T");
  const [hh, mm] = t.split(":").map(Number);
  const effectiveFrom = localToUtc(d, hh * 60 + mm, actor.factory.timeZone);
  const maxV = await db.select({ v: sql<number>`coalesce(max(${tariffVersions.version}), 0)` }).from(tariffVersions).where(eq(tariffVersions.factoryId, actor.factory.id));
  const version = Number(maxV[0]?.v ?? 0) + 1;
  const id = newId("tar");
  await db.transaction(async (tx) => {
    await tx.insert(tariffVersions).values({
      id,
      factoryId: actor.factory.id,
      version,
      name: input.name,
      effectiveFrom,
      timeZone: actor.factory.timeZone,
      normalRatePaise,
      evidence: input.evidence,
      sourceNote: input.sourceNote,
      createdBy: actor.userId,
    });
    for (const p of periods) await tx.insert(tariffPeriods).values({ id: newId("tpr"), tariffVersionId: id, ...p });
    // Any pending recommendation priced under the old tariff is now stale.
    await tx.update(recommendations).set({ status: "STALE" }).where(and(eq(recommendations.factoryId, actor.factory.id), eq(recommendations.status, "PENDING")));
    await audit(tx, actor, "tariff.create_version", "tariff_version", id, { version, effectiveFrom, normalRatePaise, periods, evidence: input.evidence });
  });
  return { id, version };
}

export async function previewRate(db: DB, actor: Actor, localDateTime: string) {
  requirePerm(actor, "view");
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(localDateTime);
  if (!m) throw validation("Use a date and time.");
  const ts = localToUtc(m[1], Number(m[2]) * 60 + Number(m[3]), actor.factory.timeZone);
  const versions = await loadTariffVersions(db, actor.factory.id);
  return { ts, rate: rateAt(versions, ts) };
}

export async function latestTariffMeta(db: DB, actor: Actor) {
  return db.query.tariffVersions.findFirst({ where: eq(tariffVersions.factoryId, actor.factory.id), orderBy: desc(tariffVersions.version) });
}
