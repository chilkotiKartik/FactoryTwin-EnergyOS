import { and, asc, eq, gte, isNotNull } from "drizzle-orm";
import type { DB } from "@/db/client";
import { heats } from "@/db/schema";
import { detectDrift, type DriftResult } from "@/domain/drift";
import { predictKwh } from "@/domain/model";
import { addDays } from "@/domain/time";
import type { Actor } from "../context";
import { requirePerm } from "../context";
import { latestModel, requireFurnace } from "./common";

/** Daily mean residual of complete metered heats over the last `days` days, and the CUSUM verdict. */
export async function secDrift(db: DB, actor: Actor, days = 90): Promise<DriftResult> {
  requirePerm(actor, "view");
  const f = actor.factory;
  const furnace = await requireFurnace(db, f.id);
  const { model } = await latestModel(db, f.id, furnace, f);
  const last = await db.select({ d: heats.dayDate }).from(heats).where(eq(heats.factoryId, f.id)).orderBy(asc(heats.dayDate));
  const to = last.at(-1)?.d;
  if (!to) return detectDrift([]);
  const rows = await db
    .select({ day: heats.dayDate, kwh: heats.meterKwh, chargeKg: heats.chargeKg, cold: heats.coldStart, hold: heats.holdingMinutes })
    .from(heats)
    .where(and(eq(heats.factoryId, f.id), gte(heats.dayDate, addDays(to, -days)), eq(heats.dataQuality, "COMPLETE"), isNotNull(heats.meterKwh)));
  const byDay = new Map<string, number[]>();
  for (const r of rows) {
    const pred = predictKwh(model, { chargeTonnes: r.chargeKg / 1000, coldStart: r.cold ?? false, holdMinutes: r.hold ?? 0 });
    if (!(pred > 0) || r.kwh === null) continue;
    const list = byDay.get(r.day) ?? [];
    list.push((100 * (r.kwh - pred)) / pred);
    byDay.set(r.day, list);
  }
  return detectDrift([...byDay].map(([day, v]) => ({ day, residualPct: v.reduce((s, x) => s + x, 0) / v.length, heats: v.length })));
}
