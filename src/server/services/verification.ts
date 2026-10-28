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
import { dailySeries, rangeSummary, type RangeSummary } from "./analytics";
import { cvPercent, diffInterval, type DiffInterval } from "@/domain/stats";
import { addDays } from "@/domain/time";
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
  /** Day-level statistics: is the SEC change larger than normal day-to-day variation? */
  statistics: {
    baselineDays: number;
    comparisonDays: number;
    baselineSecCvPct: number | null;
    secChange: DiffInterval | null;
    verdict: string;
  };
}

export const BASELINE_PERIODS = [1, 7, 14, 30] as const;

export async function computeVerification(
  db: DB,
  actor: Actor,
  baselineDay: string,
  comparisonDay: string,
  assumptions: Assumptions = DEFAULT_ASSUMPTIONS,
  opts: { baselinePeriodDays?: number } = {},
): Promise<Verification> {
  requirePerm(actor, "view");
  if (!isIsoDate(baselineDay) || !isIsoDate(comparisonDay)) throw validation("Choose valid dates.");
  const period = Math.min(60, Math.max(1, Math.round(opts.baselinePeriodDays ?? 1)));
  const baselineFrom = addDays(baselineDay, -(period - 1));
  if (period > 1 && comparisonDay >= baselineFrom && comparisonDay <= baselineDay) throw validation("The comparison day must lie outside the baseline period.");
  const [b, c, versions, bDaily, cDaily] = await Promise.all([
    rangeSummary(db, actor, baselineFrom, baselineDay),
    rangeSummary(db, actor, comparisonDay, comparisonDay),
    loadTariffVersions(db, actor.factory.id),
    dailySeries(db, actor, baselineFrom, baselineDay),
    dailySeries(db, actor, comparisonDay, comparisonDay),
  ]);
  // Production days in the baseline (days with poured metal); daily figures are per production day.
  const bDays = Math.max(1, new Set(b.heats.filter((h) => h.tapAt !== null).map((h) => h.dayDate)).size);
  const sv = savings(
    { energyKwh: b.heatsTapped ? b.energyKwh : null, tonnesPoured: b.tonnesPoured, costPaise: b.heatsTapped ? b.costPaise : null },
    { energyKwh: c.heatsTapped ? c.energyKwh : null, tonnesPoured: c.tonnesPoured, costPaise: c.heatsTapped ? c.costPaise : null },
  );
  const warnings: string[] = [];
  if (!b.heatsTapped || !c.heatsTapped) warnings.push("One of the days has no tapped heats; savings cannot be calculated.");
  if (Math.abs(b.tonnesPoured / bDays - c.tonnesPoured) > 1e-6)
    warnings.push(`Production differs (${(b.tonnesPoured / bDays).toFixed(2)} t${bDays > 1 ? " per baseline day" : ""} vs ${c.tonnesPoured.toFixed(2)} t). Compare per-tonne figures, not totals.`);
  if (bDays > 1) warnings.push(`Baseline is the ${bDays}-day period ${baselineFrom} to ${baselineDay}; totals are for the whole period, daily savings use the average production day.`);
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
  const dailyInr = (perTonneSavingPaise * (b.tonnesPoured / bDays)) / 100;
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
  const kwhSavedLikeForLike = sv.secBaseline !== null && sv.secComparison !== null ? (sv.secBaseline - sv.secComparison) * (b.tonnesPoured / bDays) : null;
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
    statistics: dayStatistics(bDaily, cDaily),
    assumptions,
    prediction,
    methodology:
      "Baseline = all metered furnace energy and tapped heats on the baseline day under current practice. Comparison = the same measures on the comparison day. Savings are per tonne so different production levels do not create false savings. Cost uses the tariff version in force at each reading. Avoided CO2 counts only avoided kWh × grid factor; load shifted in time is not credited.",
  };
}

function dayStatistics(bDaily: { sec: number | null }[], cDaily: { sec: number | null }[]): Verification["statistics"] {
  const bs = bDaily.map((d) => d.sec).filter((x): x is number => x !== null);
  const cs = cDaily.map((d) => d.sec).filter((x): x is number => x !== null);
  const secChange = diffInterval(bs, cs);
  const verdict =
    bs.length < 3
      ? "Single-day baselines cannot separate a real change from normal day-to-day variation. Use a 7- or 14-day baseline."
      : !secChange
        ? "Not enough spread in the data to estimate an interval."
        : secChange.significant
          ? `The SEC change (${secChange.diff.toFixed(1)} kWh/t, 90% interval ${secChange.low.toFixed(1)} to ${secChange.high.toFixed(1)}) is larger than normal day-to-day variation.`
          : `The SEC change (${secChange.diff.toFixed(1)} kWh/t) is within normal day-to-day variation (90% interval ${secChange.low.toFixed(1)} to ${secChange.high.toFixed(1)}). More comparison days are needed.`;
  return { baselineDays: bs.length, comparisonDays: cs.length, baselineSecCvPct: cvPercent(bs), secChange, verdict };
}

export async function createVerificationReport(
  db: DB,
  actor: Actor,
  input: { baselineDay: string; comparisonDay: string; assumptions: unknown; title?: string; baselinePeriodDays?: number },
) {
  requirePerm(actor, "verification.create");
  const a = assumptionsSchema.safeParse(input.assumptions);
  if (!a.success) throw validation(a.error.issues[0]?.message ?? "Invalid assumptions.");
  const period = BASELINE_PERIODS.includes(Number(input.baselinePeriodDays) as 1) ? Number(input.baselinePeriodDays) : 1;
  const v = await computeVerification(db, actor, input.baselineDay, input.comparisonDay, a.data, { baselinePeriodDays: period });
  const baselineFrom = addDays(input.baselineDay, -(period - 1));
  if (v.savings.energySavingKwh === null) throw validation("Both days need tapped heats and meter data to create a report.");
  const id = newId("ver");
  const exec = await db.query.executionRecords.findFirst({
    where: and(eq(s.executionRecords.factoryId, actor.factory.id), eq(s.executionRecords.dayDate, input.comparisonDay)),
  });
  await db.transaction(async (tx) => {
    await tx.insert(s.energyBaselines).values({
      id: newId("bsl"),
      factoryId: actor.factory.id,
      label: period > 1 ? `Baseline ${baselineFrom} to ${input.baselineDay}` : `Baseline ${input.baselineDay}`,
      method: period > 1 ? `${period}-day as-run period under current practice` : "Single as-run day under current practice",
      periodStartDay: baselineFrom,
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
