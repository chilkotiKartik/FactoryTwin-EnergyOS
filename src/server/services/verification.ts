import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db/client";
import * as s from "@/db/schema";
import { avoidedEmissionsKg, payback, savings } from "@/domain/energy";
import { isIsoDate } from "@/domain/time";
import type { Actor } from "../context";
import { requirePerm } from "../context";
import { audit } from "../audit";
import { notFound, validation } from "../errors";
import { newId } from "../ids";
import { rangeSummary, type RangeSummary } from "./analytics";
import { loadTariffVersions } from "./common";

export const assumptionsSchema = z.object({
  operatingDaysPerYear: z.number().min(0).max(366),
  realisationPct: z.number().min(0).max(100),
  capexInr: z.number().min(0).max(1e9),
  opexInrPerYear: z.number().min(0).max(1e9),
});
export type Assumptions = z.infer<typeof assumptionsSchema>;

/** Deck business-case assumptions (all ASSUMPTION / MODELLED). */
export const DEFAULT_ASSUMPTIONS: Assumptions = { operatingDaysPerYear: 300, realisationPct: 100, capexInr: 90000, opexInrPerYear: 60000 };

function side(sum: RangeSummary) {
  return {
    day: sum.fromDay === sum.toDay ? sum.fromDay : `${sum.fromDay}…${sum.toDay}`,
    energyKwh: sum.energyKwh,
    tonnesPoured: sum.tonnesPoured,
    heats: sum.heatsTapped,
    sec: sum.sec,
    costPaise: sum.costPaise,
    costPerTonnePaise: sum.costPerTonnePaise,
    holdingMinutes: sum.holdingMinutes,
    holdingKwh: sum.holdingKwh,
    completeness: sum.completenessOperating,
    gaps: sum.gaps.length,
    unlinkedKwh: sum.unlinkedKwh,
    emissionsKg: sum.emissionsKg,
    evidence: sum.evidence,
    lastTapAt: sum.heats.length ? Math.max(...sum.heats.map((h) => h.tapAt ?? 0)) : null,
    firstStartAt: sum.heats.length ? Math.min(...sum.heats.map((h) => h.startAt)) : null,
    costByKind: sum.costByKind,
  };
}

export type VerificationSide = ReturnType<typeof side>;

export interface Verification {
  baseline: VerificationSide;
  comparison: VerificationSide;
  savings: ReturnType<typeof savings>;
  avoidedEmissionsKg: number | null;
  emissionFactor: { value: number; source: string };
  evidenceLabel: "MEASURED" | "SIMULATED" | "UNVERIFIED" | "NO_DATA";
  warnings: string[];
  tariff: { versions: { version: number; name: string; normalRatePaise: number; periods: { label: string; startMin: number; endMin: number; ratePaise: number }[] }[] };
  payback: ReturnType<typeof payback>;
  assumptions: Assumptions;
  prediction: Record<string, unknown> | null;
  methodology: string;
}

export async function computeVerification(
  db: DB,
  actor: Actor,
  baselineDay: string,
  comparisonDay: string,
  assumptions: Assumptions = DEFAULT_ASSUMPTIONS,
): Promise<Verification> {
  requirePerm(actor, "view");
  if (!isIsoDate(baselineDay) || !isIsoDate(comparisonDay)) throw validation("Choose valid dates.");
  const [b, c, versions] = await Promise.all([
    rangeSummary(db, actor, baselineDay, baselineDay),
    rangeSummary(db, actor, comparisonDay, comparisonDay),
    loadTariffVersions(db, actor.factory.id),
  ]);
  const sv = savings(
    { energyKwh: b.heatsTapped ? b.energyKwh : null, tonnesPoured: b.tonnesPoured, costPaise: b.heatsTapped ? b.costPaise : null },
    { energyKwh: c.heatsTapped ? c.energyKwh : null, tonnesPoured: c.tonnesPoured, costPaise: c.heatsTapped ? c.costPaise : null },
  );
  const warnings: string[] = [];
  if (!b.heatsTapped || !c.heatsTapped) warnings.push("One of the days has no tapped heats; savings cannot be calculated.");
  if (Math.abs(b.tonnesPoured - c.tonnesPoured) > 1e-6)
    warnings.push(`Production differs (${b.tonnesPoured.toFixed(2)} t vs ${c.tonnesPoured.toFixed(2)} t). Compare per-tonne figures, not totals.`);
  for (const [label, x] of [["Baseline", b], ["Comparison", c]] as const) {
    if (x.completenessOperating !== null && x.completenessOperating < actor.factory.minCompleteness)
      warnings.push(`${label} day meter data is ${(x.completenessOperating * 100).toFixed(1)}% complete; its energy is understated.`);
    if (x.unpricedKwh > 0) warnings.push(`${label} day has ${x.unpricedKwh.toFixed(1)} kWh with no tariff in force; cost excludes it.`);
  }
  const labels = new Set([b.evidence, c.evidence]);
  const evidenceLabel = labels.has("SIMULATED") ? "SIMULATED" : labels.has("NO_DATA") ? "NO_DATA" : labels.size === 1 && labels.has("MEASURED") ? "MEASURED" : "UNVERIFIED";
  // Per-tonne cost saving scaled to the baseline production gives a like-for-like daily rupee saving.
  const perTonneSavingPaise =
    sv.costPerTonneBaseline !== null && sv.costPerTonneComparison !== null ? sv.costPerTonneBaseline - sv.costPerTonneComparison : 0;
  const dailyInr = (perTonneSavingPaise * b.tonnesPoured) / 100;
  const pb = payback({
    dailyCostSavingInr: dailyInr,
    operatingDaysPerYear: assumptions.operatingDaysPerYear,
    realisation: assumptions.realisationPct / 100,
    capexInr: assumptions.capexInr,
    opexInrPerYear: assumptions.opexInrPerYear,
  });
  const exec = await db.query.executionRecords.findFirst({
    where: and(eq(s.executionRecords.factoryId, actor.factory.id), eq(s.executionRecords.dayDate, comparisonDay)),
    orderBy: desc(s.executionRecords.createdAt),
  });
  let prediction: Record<string, unknown> | null = null;
  if (exec?.recommendationId) {
    const rec = await db.query.recommendations.findFirst({ where: eq(s.recommendations.id, exec.recommendationId) });
    if (rec) prediction = { recommendationId: rec.id, version: rec.version, ...rec.predicted };
  }
  // Like-for-like energy saving per tonne, applied to baseline production, for emissions.
  const kwhSavedLikeForLike = sv.secBaseline !== null && sv.secComparison !== null ? (sv.secBaseline - sv.secComparison) * b.tonnesPoured : null;
  return {
    baseline: side(b),
    comparison: side(c),
    savings: sv,
    avoidedEmissionsKg: avoidedEmissionsKg(kwhSavedLikeForLike, actor.factory.emissionFactor),
    emissionFactor: { value: actor.factory.emissionFactor, source: actor.factory.emissionFactorSource },
    evidenceLabel,
    warnings,
    tariff: {
      versions: versions.map((v) => ({
        version: v.version,
        name: v.name,
        normalRatePaise: v.normalRatePaise,
        periods: v.periods.map((p) => ({ label: p.label, startMin: p.startMin, endMin: p.endMin, ratePaise: p.ratePaise })),
      })),
    },
    payback: pb,
    assumptions,
    prediction,
    methodology:
      "Baseline = all metered furnace energy and tapped heats on the baseline day under current practice. Comparison = the same measures on the comparison day. Savings are per tonne so different production levels do not create false savings. Cost uses the tariff version in force at each reading. Avoided CO2 counts only avoided kWh × grid factor; load shifted in time is not credited.",
  };
}

export async function createVerificationReport(
  db: DB,
  actor: Actor,
  input: { baselineDay: string; comparisonDay: string; assumptions: unknown; title?: string },
) {
  requirePerm(actor, "verification.create");
  const a = assumptionsSchema.safeParse(input.assumptions);
  if (!a.success) throw validation(a.error.issues[0]?.message ?? "Invalid assumptions.");
  const v = await computeVerification(db, actor, input.baselineDay, input.comparisonDay, a.data);
  if (v.savings.energySavingKwh === null) throw validation("Both days need tapped heats and meter data to create a report.");
  const id = newId("ver");
  const exec = await db.query.executionRecords.findFirst({
    where: and(eq(s.executionRecords.factoryId, actor.factory.id), eq(s.executionRecords.dayDate, input.comparisonDay)),
  });
  await db.transaction(async (tx) => {
    await tx.insert(s.energyBaselines).values({
      id: newId("bsl"),
      factoryId: actor.factory.id,
      label: `Baseline ${input.baselineDay}`,
      method: "Single as-run day under current practice",
      periodStartDay: input.baselineDay,
      periodEndDay: input.baselineDay,
      energyKwh: v.baseline.energyKwh,
      tonnesPoured: v.baseline.tonnesPoured,
      costPaise: v.baseline.costPaise,
      holdingMinutes: v.baseline.holdingMinutes,
      completeness: v.baseline.completeness,
      evidenceLabel: v.baseline.evidence,
      createdBy: actor.userId,
    });
    await tx.insert(s.verificationReports).values({
      id,
      factoryId: actor.factory.id,
      title: input.title?.trim() || `Verification ${input.baselineDay} vs ${input.comparisonDay}`,
      baselineDay: input.baselineDay,
      comparisonDay: input.comparisonDay,
      executionId: exec?.id ?? null,
      evidenceLabel: v.evidenceLabel,
      metrics: v as unknown as Record<string, unknown>,
      assumptions: a.data,
      createdBy: actor.userId,
    });
    await audit(tx, actor, "verification.create", "verification_report", id, {
      baselineDay: input.baselineDay,
      comparisonDay: input.comparisonDay,
      evidence: v.evidenceLabel,
      secChangePct: v.savings.secChangePercent,
      costPerTonneChangePct: v.savings.costPerTonneChangePercent,
    });
  });
  return id;
}

export async function listVerificationReports(db: DB, actor: Actor) {
  requirePerm(actor, "view");
  return db
    .select({ r: s.verificationReports, author: s.users.name })
    .from(s.verificationReports)
    .leftJoin(s.users, eq(s.users.id, s.verificationReports.createdBy))
    .where(eq(s.verificationReports.factoryId, actor.factory.id))
    .orderBy(desc(s.verificationReports.createdAt));
}

export async function getVerificationReport(db: DB, actor: Actor, id: string) {
  requirePerm(actor, "view");
  const r = await db.query.verificationReports.findFirst({ where: and(eq(s.verificationReports.id, id), eq(s.verificationReports.factoryId, actor.factory.id)) });
  if (!r) throw notFound("Report");
  return r;
}
