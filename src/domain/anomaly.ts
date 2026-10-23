import { expectedGoodPracticeKwh, type EnergyModel } from "./model";
import { variancePercent } from "./energy";
import { formatLocalTime } from "./time";

/**
 * Explainable expected-vs-actual anomaly detection for one heat.
 *
 * Only what the meter and the heat log can show is used. The trace is split into
 * phases by power level: full-power melting, a low "holding" plateau, and off.
 * Furnace-lid position, slag, charge chemistry and similar conditions cannot be
 * seen in an energy trace and are never inferred.
 */

export const ANOMALY_RULE = "EXPECTED_VS_ACTUAL_V1";
export const ANOMALY_RULE_TEXT =
  "Flag a heat when actual − expected kWh exceeds the larger of 5% of expected and 3 × the model's RMSE. Expected = model prediction with holding minutes set to zero.";

export type EvidenceLevel = "CONFIRMED" | "STRONG" | "HYPOTHESIS" | "INSUFFICIENT";
export type Severity = "HIGH" | "MEDIUM" | "LOW";
export type PhaseKind = "MELT" | "HOLD" | "OFF" | "OTHER" | "MISSING";

export interface TracePoint {
  ts: number;
  powerKw: number;
  energyKwh: number;
}

export interface Phase {
  kind: PhaseKind;
  from: number;
  to: number;
  minutes: number;
  kwh: number;
  avgKw: number;
}

export interface HeatForAnalysis {
  id: string;
  heatNo: string;
  startAt: number;
  tapAt: number;
  chargeKg: number;
  coldStart: boolean;
  mouldSet: number | null;
  mouldReadyAt: number | null;
  /** Melt-complete time from the heat log, if recorded. */
  meltEndAt: number | null;
}

export interface AnalysisConfig {
  ratedKw: number;
  holdingKw: number;
  nominalMeltMinutes: number;
  intervalSeconds: number;
  timeZone: string;
}

export interface Finding {
  level: EvidenceLevel;
  title: string;
  detail: string;
  source: "METER" | "HEAT_LOG" | "METER+HEAT_LOG" | "MODEL";
}

export interface HeatAnalysis {
  heatId: string;
  actualKwh: number | null;
  expectedKwh: number;
  varianceKwh: number | null;
  variancePct: number | null;
  thresholdKwh: number;
  flagged: boolean;
  severity: Severity | null;
  completeness: number;
  phases: Phase[];
  holdingMinutes: number;
  holdingKwh: number;
  metalReadyAt: number | null;
  meltMinutes: number;
  evidenceLevel: EvidenceLevel;
  findings: Finding[];
  explanation: string;
  suggestedInvestigation: string[];
  rule: string;
  modelVersion: string;
}

export function classifyPower(kw: number, cfg: Pick<AnalysisConfig, "ratedKw" | "holdingKw">): PhaseKind {
  if (kw < 5) return "OFF";
  if (kw >= cfg.ratedKw * 0.5) return "MELT";
  if (kw >= cfg.holdingKw * 0.25 && kw <= Math.max(cfg.holdingKw * 2.5, 30)) return "HOLD";
  return "OTHER";
}

/** Segment a heat's trace into contiguous phases; gaps in the data become MISSING phases. */
export function segmentTrace(points: TracePoint[], windowStart: number, windowEnd: number, cfg: AnalysisConfig): Phase[] {
  const step = cfg.intervalSeconds * 1000;
  const phases: Phase[] = [];
  const push = (kind: PhaseKind, from: number, to: number, kwh: number) => {
    const last = phases[phases.length - 1];
    if (last && last.kind === kind && last.to === from) {
      last.to = to;
      last.kwh += kwh;
    } else {
      phases.push({ kind, from, to, minutes: 0, kwh, avgKw: 0 });
    }
  };
  let cursor = windowStart;
  const sorted = points.filter((p) => p.ts >= windowStart && p.ts < windowEnd).sort((a, b) => a.ts - b.ts);
  for (const p of sorted) {
    if (p.ts > cursor) push("MISSING", cursor, p.ts, 0);
    push(classifyPower(p.powerKw, cfg), p.ts, p.ts + step, p.energyKwh);
    cursor = p.ts + step;
  }
  if (cursor < windowEnd) push("MISSING", cursor, windowEnd, 0);
  for (const ph of phases) {
    ph.minutes = (ph.to - ph.from) / 60000;
    ph.avgKw = ph.minutes > 0 ? (ph.kwh * 60) / ph.minutes : 0;
  }
  return phases;
}

export function analyseHeat(
  heat: HeatForAnalysis,
  points: TracePoint[],
  model: EnergyModel,
  cfg: AnalysisConfig,
): HeatAnalysis {
  const step = cfg.intervalSeconds * 1000;
  const expectedSlots = Math.max(1, Math.round((heat.tapAt - heat.startAt) / step));
  const inWindow = points.filter((p) => p.ts >= heat.startAt && p.ts < heat.tapAt);
  const completeness = Math.min(1, inWindow.length / expectedSlots);
  const actualKwh = inWindow.length ? inWindow.reduce((s, p) => s + p.energyKwh, 0) : null;
  const expectedKwh = expectedGoodPracticeKwh(model, { chargeTonnes: heat.chargeKg / 1000, coldStart: heat.coldStart });
  const phases = segmentTrace(inWindow, heat.startAt, heat.tapAt, cfg);

  const meltPhases = phases.filter((p) => p.kind === "MELT");
  const lastMelt = meltPhases[meltPhases.length - 1];
  const metalReadyAt = lastMelt ? lastMelt.to : heat.meltEndAt;
  const meltMinutes = meltPhases.reduce((s, p) => s + p.minutes, 0);
  const holdPhases = phases.filter((p) => p.kind === "HOLD" && lastMelt && p.from >= lastMelt.to && p.minutes >= 3);
  const holdingMinutes = holdPhases.reduce((s, p) => s + p.minutes, 0);
  const holdingKwh = holdPhases.reduce((s, p) => s + p.kwh, 0);

  const rmse = model.rmseKwh ?? 0;
  const thresholdKwh = Math.max(0.05 * expectedKwh, 3 * rmse);
  const varianceKwh = actualKwh === null ? null : actualKwh - expectedKwh;
  const variancePct = variancePercent(actualKwh, expectedKwh);
  const lowCoverage = completeness < 0.9;
  const flagged = varianceKwh !== null && varianceKwh > thresholdKwh;
  const severity: Severity | null = !flagged || variancePct === null ? null : variancePct >= 10 ? "HIGH" : variancePct >= 5 ? "MEDIUM" : "LOW";

  const t = (ts: number) => formatLocalTime(ts, cfg.timeZone);
  const findings: Finding[] = [];
  const investigate: string[] = [];

  if (lowCoverage) {
    const missingMin = phases.filter((p) => p.kind === "MISSING").reduce((s, p) => s + p.minutes, 0);
    findings.push({
      level: "INSUFFICIENT",
      title: "Meter data incomplete for this heat",
      detail: `${Math.round(missingMin)} of ${Math.round(expectedSlots * cfg.intervalSeconds / 60)} minutes have no reading (${(completeness * 100).toFixed(0)}% coverage). Actual energy is understated and no cause can be assigned.`,
      source: "METER",
    });
    investigate.push("Check the meter link and gateway buffer for this time range before drawing conclusions.");
  }

  if (holdPhases.length > 0) {
    const first = holdPhases[0];
    const last = holdPhases[holdPhases.length - 1];
    findings.push({
      level: "CONFIRMED",
      title: `Holding plateau: ${Math.round(holdingMinutes)} min at about ${Math.round(holdingKwh * 60 / Math.max(1, holdingMinutes))} kW`,
      detail: `The trace drops from full power to a low plateau at ${t(first.from)} and stays there until ${t(last.to)} (tap). That plateau used ${holdingKwh.toFixed(1)} kWh. Pattern seen directly in the meter readings.`,
      source: "METER",
    });
    if (heat.mouldReadyAt !== null && heat.mouldSet !== null) {
      const waitMin = metalReadyAt !== null ? (heat.mouldReadyAt - metalReadyAt) / 60000 : null;
      const tapAfterMould = (heat.tapAt - heat.mouldReadyAt) / 60000;
      if (waitMin !== null && waitMin > 2 && tapAfterMould >= -1 && tapAfterMould <= 5) {
        findings.push({
          level: "STRONG",
          title: `Mould set ${heat.mouldSet} was not ready`,
          detail: `The heat log records mould set ${heat.mouldSet} ready at ${t(heat.mouldReadyAt)}, ${Math.round(waitMin)} min after metal was ready at ${t(metalReadyAt!)}. ${Math.round(tapAfterMould) <= 0 ? "Tap happened as soon as the mould was ready." : `Tap followed ${Math.round(tapAfterMould)} min after mould readiness.`} Strong evidence that the hold was waiting for moulds.`,
          source: "METER+HEAT_LOG",
        });
        investigate.push(`Review the moulding plan for set ${heat.mouldSet}: start the melt later, or bring moulding forward, so metal does not wait.`);
      } else {
        findings.push({
          level: "HYPOTHESIS",
          title: "Cause of the hold is not recorded",
          detail: `Mould set ${heat.mouldSet} is logged ready at ${t(heat.mouldReadyAt)}, which does not line up with the end of the hold. The hold may have another cause (ladle, crane, sampling) that the log does not capture.`,
          source: "HEAT_LOG",
        });
        investigate.push("Ask the shift what the metal was waiting for and add it to the heat note.");
      }
    } else {
      findings.push({
        level: "HYPOTHESIS",
        title: "No mould-readiness record",
        detail: "The heat log has no mould-ready time for this heat, so the reason for the hold cannot be checked.",
        source: "HEAT_LOG",
      });
      investigate.push("Record mould-ready times in the heat log so holds can be attributed.");
    }
  }

  if (meltMinutes > cfg.nominalMeltMinutes * 1.25 + (heat.coldStart ? 5 : 0)) {
    findings.push({
      level: "CONFIRMED",
      title: `Long melt: ${Math.round(meltMinutes)} min at full power`,
      detail: `Nominal melt is about ${cfg.nominalMeltMinutes} min at full power. Longer melts are visible in the trace; the trace cannot show why (charge mix, lid opening and slag are not observable from energy alone).`,
      source: "METER",
    });
    investigate.push("Check charge make-up and furnace practice for this heat; record findings in the heat note.");
  }

  const unexplained = varianceKwh === null ? null : varianceKwh - holdingKwh;
  if (flagged && unexplained !== null && unexplained > thresholdKwh) {
    findings.push({
      level: "HYPOTHESIS",
      title: `${unexplained.toFixed(0)} kWh not explained by holding`,
      detail: "This part of the excess occurred while the furnace was at full power. Lid position, slag and charge condition cannot be observed in an energy trace, so no cause is assigned.",
      source: "MODEL",
    });
    investigate.push("Compare with the operator's note for this heat; consider a melt-practice check.");
  }

  if (heat.coldStart) {
    findings.push({
      level: "CONFIRMED",
      title: "Cold start",
      detail: "First heat of the day or after a long gap. The expected energy already includes the model's cold-start allowance.",
      source: "MODEL",
    });
  }

  let evidenceLevel: EvidenceLevel;
  if (lowCoverage) evidenceLevel = "INSUFFICIENT";
  else if (varianceKwh !== null && varianceKwh > 0 && holdingKwh >= 0.8 * varianceKwh && findings.some((f) => f.level === "STRONG")) evidenceLevel = "CONFIRMED";
  else if (varianceKwh !== null && varianceKwh > 0 && holdingKwh >= 0.5 * varianceKwh) evidenceLevel = "STRONG";
  else evidenceLevel = flagged ? "HYPOTHESIS" : "CONFIRMED";

  let explanation: string;
  if (actualKwh === null) explanation = "No meter readings for this heat.";
  else if (lowCoverage) explanation = "Meter coverage is too low to explain this heat's energy.";
  else if (!flagged) explanation = `Within tolerance: ${varianceKwh! >= 0 ? "+" : ""}${varianceKwh!.toFixed(1)} kWh against ${expectedKwh.toFixed(0)} kWh expected.`;
  else if (holdingKwh > 0) {
    const mould = findings.find((f) => f.level === "STRONG");
    explanation = `${actualKwh.toFixed(0)} kWh used, ${expectedKwh.toFixed(0)} expected (+${variancePct!.toFixed(1)}%). ${Math.round(holdingMinutes)} min at holding power accounts for ${holdingKwh.toFixed(0)} kWh${mould ? `; ${mould.title.toLowerCase()}` : ""}.`;
  } else explanation = `${actualKwh.toFixed(0)} kWh used, ${expectedKwh.toFixed(0)} expected (+${variancePct!.toFixed(1)}%). No holding plateau; the excess occurred at full power and its cause is not observable from the meter.`;

  return {
    heatId: heat.id,
    actualKwh,
    expectedKwh,
    varianceKwh,
    variancePct,
    thresholdKwh,
    flagged: flagged || (lowCoverage && actualKwh !== null),
    severity: lowCoverage && !flagged ? "LOW" : severity,
    completeness,
    phases,
    holdingMinutes,
    holdingKwh,
    metalReadyAt: metalReadyAt ?? null,
    meltMinutes,
    evidenceLevel,
    findings,
    explanation,
    suggestedInvestigation: investigate,
    rule: ANOMALY_RULE,
    modelVersion: model.version,
  };
}
