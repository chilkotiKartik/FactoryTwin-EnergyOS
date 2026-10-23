import { and, asc, desc, eq, gte, lt } from "drizzle-orm";
import type { DB } from "@/db/client";
import { furnaces, meterReadings, meters, modelFits, tariffPeriods, tariffVersions } from "@/db/schema";
import type { TariffVersion } from "@/domain/tariff";
import { physicsPrior, type EnergyModel } from "@/domain/model";
import { notFound } from "../errors";

export async function loadTariffVersions(db: DB, factoryId: string): Promise<TariffVersion[]> {
  const versions = await db.select().from(tariffVersions).where(eq(tariffVersions.factoryId, factoryId)).orderBy(asc(tariffVersions.version));
  if (!versions.length) return [];
  const periods = await db.select().from(tariffPeriods);
  return versions.map((v) => ({
    id: v.id,
    version: v.version,
    name: v.name,
    effectiveFrom: v.effectiveFrom,
    timeZone: v.timeZone,
    normalRatePaise: v.normalRatePaise,
    periods: periods
      .filter((p) => p.tariffVersionId === v.id)
      .sort((a, b) => a.startMin - b.startMin)
      .map((p) => ({ kind: p.kind, label: p.label, startMin: p.startMin, endMin: p.endMin, ratePaise: p.ratePaise })),
  }));
}

export async function primaryFurnace(db: DB, factoryId: string) {
  const f = await db.query.furnaces.findFirst({ where: eq(furnaces.factoryId, factoryId), orderBy: asc(furnaces.name) });
  return f ?? null;
}

export async function requireFurnace(db: DB, factoryId: string) {
  const f = await primaryFurnace(db, factoryId);
  if (!f) throw notFound("Furnace");
  return f;
}

export async function primaryMeter(db: DB, factoryId: string) {
  const m = await db.query.meters.findFirst({ where: eq(meters.factoryId, factoryId), orderBy: asc(meters.name) });
  return m ?? null;
}

export async function readingsBetween(db: DB, factoryId: string, from: number, to: number) {
  return db
    .select({ ts: meterReadings.ts, powerKw: meterReadings.powerKw, energyKwh: meterReadings.energyKwh, quality: meterReadings.quality, provenance: meterReadings.provenance })
    .from(meterReadings)
    .where(and(eq(meterReadings.factoryId, factoryId), gte(meterReadings.ts, from), lt(meterReadings.ts, to)))
    .orderBy(asc(meterReadings.ts));
}

export async function latestModel(db: DB, factoryId: string, furnace: { ratedKw: number; nominalMeltMinutes: number; capacityKg: number }, factory: { coldExtraMinutes: number; holdingKw: number }): Promise<{ model: EnergyModel; fitId: string | null; createdAt: number | null }> {
  const fit = await db.query.modelFits.findFirst({ where: eq(modelFits.factoryId, factoryId), orderBy: desc(modelFits.createdAt) });
  if (!fit) {
    return {
      model: physicsPrior(furnace.ratedKw, furnace.nominalMeltMinutes, furnace.capacityKg / 1000, factory.coldExtraMinutes, factory.holdingKw),
      fitId: null,
      createdAt: null,
    };
  }
  const c = fit.coefficients;
  return {
    model: {
      version: fit.version,
      kind: fit.kind as EnergyModel["kind"],
      coefficients: { intercept: c.intercept ?? 0, perTonne: c.perTonne ?? 0, coldStart: c.coldStart ?? 0, perHoldMinute: c.perHoldMinute ?? 0 },
      n: fit.n,
      r2: fit.r2,
      rmseKwh: fit.rmseKwh,
      note: fit.note,
    },
    fitId: fit.id,
    createdAt: fit.createdAt,
  };
}
