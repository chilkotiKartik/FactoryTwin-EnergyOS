import { and, asc, desc, eq, gte, like, lte, ne, or, sql, inArray, isNotNull, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db/client";
import { anomalies, heats, users } from "@/db/schema";
import { isIsoDate, localDate, localToUtc } from "@/domain/time";
import type { Actor } from "../context";
import { requirePerm } from "../context";
import { audit } from "../audit";
import { AppError, conflict, notFound, validation } from "../errors";
import { newId } from "../ids";
import { requireFurnace } from "./common";
import { analyseFactory } from "./analysis";
import { heatInputSchema, type HeatInput } from "@/lib/schemas/heat";

export { heatInputSchema };

export interface HeatListQuery {
  day?: string;
  q?: string;
  quality?: string;
  flagged?: boolean;
  page?: number;
  pageSize?: number;
}

export async function listHeats(db: DB, actor: Actor, query: HeatListQuery) {
  requirePerm(actor, "view");
  const pageSize = Math.min(100, Math.max(5, query.pageSize ?? 25));
  const page = Math.max(1, query.page ?? 1);
  const conds: (SQL | undefined)[] = [eq(heats.factoryId, actor.factory.id)];
  if (query.day && isIsoDate(query.day)) conds.push(eq(heats.dayDate, query.day));
  if (query.q) {
    const q = `%${query.q.replace(/[%_]/g, "").slice(0, 40)}%`;
    conds.push(or(like(heats.heatNo, q), like(heats.grade, q), like(heats.orderCode, q), like(heats.operatorNotes, q)));
  }
  if (query.quality && ["COMPLETE", "PARTIAL", "NO_METER_DATA", "OPEN", "NOT_ANALYSED"].includes(query.quality)) {
    conds.push(eq(heats.dataQuality, query.quality as "COMPLETE"));
  }
  if (query.flagged) {
    conds.push(sql`exists (select 1 from ${anomalies} a where a.heat_id = ${heats.id} and a.severity is not null)`);
  }
  const where = and(...conds);
  const [rows, total] = await Promise.all([
    db
      .select()
      .from(heats)
      .where(where)
      .orderBy(desc(heats.dayDate), asc(heats.startAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ c: sql<number>`count(*)` }).from(heats).where(where),
  ]);
  const ids = rows.map((r) => r.id);
  const anoms = ids.length
    ? await db
        .select({ heatId: anomalies.heatId, id: anomalies.id, severity: anomalies.severity, evidenceLevel: anomalies.evidenceLevel })
        .from(anomalies)
        .where(and(inArray(anomalies.heatId, ids), isNotNull(anomalies.severity)))
    : [];
  return {
    rows: rows.map((r) => ({ ...r, anomaly: anoms.find((a) => a.heatId === r.id) ?? null })),
    total: Number(total[0]?.c ?? 0),
    page,
    pageSize,
  };
}

export async function getHeat(db: DB, actor: Actor, id: string) {
  requirePerm(actor, "view");
  const rows = await db
    .select({ h: heats, createdByName: users.name })
    .from(heats)
    .leftJoin(users, eq(users.id, heats.createdBy))
    .where(and(eq(heats.id, id), eq(heats.factoryId, actor.factory.id)))
    .limit(1);
  return rows[0] ?? null;
}

function toUtc(v: string, tz: string): number {
  const [d, t] = v.split("T");
  const [h, m] = t.split(":").map(Number);
  return localToUtc(d, h * 60 + m, tz);
}

const num = (v: number | null | undefined) => (v === null || v === undefined || Number.isNaN(v) ? null : v);

async function validateHeat(db: DB, actor: Actor, input: HeatInput, excludeId: string | null) {
  const f = actor.factory;
  const furnace = await requireFurnace(db, f.id);
  const errors: Record<string, string> = {};
  const startAt = toUtc(input.startAt, f.timeZone);
  const tapAt = input.tapAt ? toUtc(input.tapAt, f.timeZone) : null;
  const mouldReadyAt = input.mouldReadyAt ? toUtc(input.mouldReadyAt, f.timeZone) : null;
  const poured = num(input.pouredKg);
  const manualKwh = num(input.manualKwh);
  const mouldSet = num(input.mouldSet);
  if (input.chargeKg > furnace.capacityKg) errors.chargeKg = `Above furnace capacity (${furnace.capacityKg} kg).`;
  if (poured !== null && (poured < 0 || poured > input.chargeKg)) errors.pouredKg = "Poured must be between 0 and the charge.";
  if (tapAt !== null && tapAt <= startAt) errors.tapAt = "Tap must be after start.";
  if (tapAt !== null && tapAt - startAt > 8 * 3600_000) errors.tapAt = "A heat longer than 8 hours is not plausible; check the times.";
  if (tapAt !== null && poured === null) errors.pouredKg = "Enter poured kg for a tapped heat.";
  if (manualKwh !== null && (manualKwh < 0 || manualKwh > 20000)) errors.manualKwh = "Energy must be between 0 and 20,000 kWh.";
  if (mouldSet !== null && (!Number.isInteger(mouldSet) || mouldSet < 1 || mouldSet > 999)) errors.mouldSet = "Mould set must be a whole number.";
  if (startAt > Date.now() + 24 * 3600_000) errors.startAt = "Start cannot be more than a day in the future.";
  const dayDate = localDate(startAt, f.timeZone);
  if (Object.keys(errors).length) throw validation("Fix the highlighted fields.", errors);

  // One heat at a time on the furnace.
  const end = tapAt ?? startAt + 60_000;
  const overlap = await db
    .select({ id: heats.id, heatNo: heats.heatNo, dayDate: heats.dayDate })
    .from(heats)
    .where(
      and(
        eq(heats.factoryId, f.id),
        eq(heats.furnaceId, furnace.id),
        excludeId ? ne(heats.id, excludeId) : undefined,
        sql`${heats.startAt} < ${end}`,
        sql`coalesce(${heats.tapAt}, ${heats.startAt} + 60000) > ${startAt}`,
      ),
    )
    .limit(1);
  if (overlap[0]) throw validation(`Overlaps heat ${overlap[0].heatNo} on ${overlap[0].dayDate}. The furnace runs one heat at a time.`, { startAt: "Overlaps another heat" });
  const dup = await db
    .select({ id: heats.id })
    .from(heats)
    .where(and(eq(heats.factoryId, f.id), eq(heats.dayDate, dayDate), eq(heats.heatNo, input.heatNo), excludeId ? ne(heats.id, excludeId) : undefined))
    .limit(1);
  if (dup[0]) throw validation(`Heat ${input.heatNo} already exists on ${dayDate}.`, { heatNo: "Already used on this day" });
  return { furnace, startAt, tapAt, mouldReadyAt, poured, manualKwh, mouldSet, dayDate };
}

export async function createHeat(db: DB, actor: Actor, raw: unknown) {
  requirePerm(actor, "heat.write");
  const parsed = heatInputSchema.safeParse(raw);
  if (!parsed.success) throw zodToValidation(parsed.error);
  const input = parsed.data;
  const id = newId("het");
  await db.transaction(async (tx) => {
    // Overlap and duplicate checks run inside the write transaction (SQLite
    // serialises writers), so two tablets cannot create overlapping heats.
    const v = await validateHeat(tx as unknown as DB, actor, input, null);
    await tx.insert(heats).values({
      id,
      factoryId: actor.factory.id,
      furnaceId: v.furnace.id,
      dayDate: v.dayDate,
      heatNo: input.heatNo,
      grade: input.grade,
      orderCode: input.orderCode || null,
      chargeKg: input.chargeKg,
      pouredKg: v.poured,
      startAt: v.startAt,
      tapAt: v.tapAt,
      mouldSet: v.mouldSet,
      mouldReadyAt: v.mouldReadyAt,
      manualKwh: v.manualKwh,
      operatorNotes: input.operatorNotes,
      provenance: "MANUAL",
      createdBy: actor.userId,
      updatedBy: actor.userId,
      updatedAt: Date.now(),
    });
    await audit(tx, actor, "heat.create", "heat", id, { heatNo: input.heatNo, dayDate: v.dayDate });
  });
  await analyseFactory(db, actor, "heat.create");
  return id;
}

export async function updateHeat(db: DB, actor: Actor, id: string, expectedRevision: number, raw: unknown) {
  requirePerm(actor, "heat.write");
  const existing = await db.query.heats.findFirst({ where: and(eq(heats.id, id), eq(heats.factoryId, actor.factory.id)) });
  if (!existing) throw notFound("Heat");
  if (existing.revision !== expectedRevision) throw new AppError("STALE", "This heat was changed by someone else. Reload to see the latest version.");
  const parsed = heatInputSchema.safeParse(raw);
  if (!parsed.success) throw zodToValidation(parsed.error);
  const input = parsed.data;
  await db.transaction(async (tx) => {
    const v = await validateHeat(tx as unknown as DB, actor, input, id);
    const changes = {
      heatNo: input.heatNo,
      grade: input.grade,
      orderCode: input.orderCode || null,
      chargeKg: input.chargeKg,
      pouredKg: v.poured,
      startAt: v.startAt,
      tapAt: v.tapAt,
      mouldSet: v.mouldSet,
      mouldReadyAt: v.mouldReadyAt,
      manualKwh: v.manualKwh,
      operatorNotes: input.operatorNotes,
      dayDate: v.dayDate,
    };
    const diff: Record<string, { from: unknown; to: unknown }> = {};
    for (const [k, val] of Object.entries(changes)) {
      const before = (existing as Record<string, unknown>)[k];
      if (before !== val) diff[k] = { from: before, to: val };
    }
    const res = await tx
      .update(heats)
      .set({
        ...changes,
        // A synthetic record edited by a person is no longer purely simulated.
        provenance: existing.provenance === "SIMULATED" && Object.keys(diff).some((k) => k !== "operatorNotes") ? "MANUAL" : existing.provenance,
        updatedBy: actor.userId,
        updatedAt: Date.now(),
        revision: existing.revision + 1,
      })
      .where(and(eq(heats.id, id), eq(heats.revision, expectedRevision)));
    if (res.rowsAffected !== 1) throw conflict("The heat changed while saving. Reload and try again.");
    await audit(tx, actor, "heat.update", "heat", id, { heatNo: input.heatNo, changes: diff });
  });
  await analyseFactory(db, actor, "heat.update");
}

export function zodToValidation(err: z.ZodError) {
  const fieldErrors: Record<string, string> = {};
  for (const i of err.issues) {
    const k = String(i.path[0] ?? "form");
    if (!fieldErrors[k]) fieldErrors[k] = i.message;
  }
  return validation("Fix the highlighted fields.", fieldErrors);
}

export async function heatDaysRange(db: DB, actor: Actor, fromDay: string, toDay: string) {
  return db
    .select()
    .from(heats)
    .where(and(eq(heats.factoryId, actor.factory.id), gte(heats.dayDate, fromDay), lte(heats.dayDate, toDay)))
    .orderBy(asc(heats.startAt));
}
