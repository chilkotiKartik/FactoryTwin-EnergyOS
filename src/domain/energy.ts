import { rateAt, type TariffVersion } from "./tariff";

/**
 * Core energy formulas. Every function returns null instead of a misleading
 * number when the denominator is zero or an input is missing / not finite.
 */

const finite = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/** SEC = total_energy_kWh / tonnes_poured  (kWh/t) */
export function specificEnergy(totalKwh: number | null | undefined, tonnesPoured: number | null | undefined): number | null {
  if (!finite(totalKwh) || !finite(tonnesPoured) || tonnesPoured <= 0 || totalKwh < 0) return null;
  return totalKwh / tonnesPoured;
}

/** variance_kWh = actual_kWh − expected_kWh */
export function varianceKwh(actual: number | null | undefined, expected: number | null | undefined): number | null {
  if (!finite(actual) || !finite(expected)) return null;
  return actual - expected;
}

/** variance_percent = 100 × variance_kWh / expected_kWh */
export function variancePercent(actual: number | null | undefined, expected: number | null | undefined): number | null {
  const v = varianceKwh(actual, expected);
  if (v === null || !finite(expected) || expected <= 0) return null;
  return (100 * v) / expected;
}

/** holding_energy_kWh = holding_power_kW × holding_minutes / 60 (an estimate, not a meter value) */
export function holdingEnergyKwh(holdingPowerKw: number | null | undefined, holdingMinutes: number | null | undefined): number | null {
  if (!finite(holdingPowerKw) || !finite(holdingMinutes) || holdingPowerKw < 0 || holdingMinutes < 0) return null;
  return (holdingPowerKw * holdingMinutes) / 60;
}

/** cost_per_tonne = energy_cost / tonnes_poured */
export function costPerTonne(costPaise: number | null | undefined, tonnesPoured: number | null | undefined): number | null {
  if (!finite(costPaise) || !finite(tonnesPoured) || tonnesPoured <= 0) return null;
  return costPaise / tonnesPoured;
}

export interface IntervalReading {
  ts: number;
  /** Energy in the interval that starts at ts, kWh. */
  energyKwh: number;
}

export interface CostBreakdown {
  totalPaise: number;
  pricedKwh: number;
  /** kWh that could not be priced because no tariff version was in force. */
  unpricedKwh: number;
  byKind: Record<string, { kwh: number; paise: number }>;
}

/** energy_cost = Σ interval_kWh × applicable_tariff(interval start) */
export function energyCost(readings: IntervalReading[], versions: TariffVersion[]): CostBreakdown {
  const out: CostBreakdown = { totalPaise: 0, pricedKwh: 0, unpricedKwh: 0, byKind: {} };
  for (const r of readings) {
    if (!finite(r.energyKwh) || r.energyKwh < 0) continue;
    const rate = rateAt(versions, r.ts);
    if (!rate) {
      out.unpricedKwh += r.energyKwh;
      continue;
    }
    const paise = r.energyKwh * rate.ratePaise;
    out.totalPaise += paise;
    out.pricedKwh += r.energyKwh;
    const k = (out.byKind[rate.kind] ??= { kwh: 0, paise: 0 });
    k.kwh += r.energyKwh;
    k.paise += paise;
  }
  return out;
}

/**
 * Avoid double counting: holding energy seen on the meter is already inside the
 * heat's metered kWh. Only use the holding_power × minutes estimate when the
 * metered heat energy is missing.
 */
export function heatEnergyWithHoldingEstimate(
  meteredKwh: number | null,
  estimatedMeltKwh: number | null,
  holdingPowerKw: number,
  holdingMinutes: number,
): { kwh: number | null; source: "METER" | "ESTIMATE" | "NONE" } {
  if (finite(meteredKwh)) return { kwh: meteredKwh, source: "METER" };
  const hold = holdingEnergyKwh(holdingPowerKw, holdingMinutes);
  if (finite(estimatedMeltKwh) && hold !== null) return { kwh: estimatedMeltKwh + hold, source: "ESTIMATE" };
  return { kwh: null, source: "NONE" };
}

/** Avoided CO2 (kg) from avoided kWh only. Load shifted in time is not credited. */
export function avoidedEmissionsKg(energySavingKwh: number | null, factorKgPerKwh: number): number | null {
  if (!finite(energySavingKwh) || !finite(factorKgPerKwh) || factorKgPerKwh < 0) return null;
  return energySavingKwh * factorKgPerKwh;
}

export function emissionsKg(energyKwh: number | null, factorKgPerKwh: number): number | null {
  if (!finite(energyKwh) || !finite(factorKgPerKwh) || factorKgPerKwh < 0) return null;
  return energyKwh * factorKgPerKwh;
}

export interface SavingsResult {
  energySavingKwh: number | null;
  energySavingPercent: number | null;
  costSavingPaise: number | null;
  costSavingPercent: number | null;
  secBaseline: number | null;
  secComparison: number | null;
  secChangePercent: number | null;
  costPerTonneBaseline: number | null;
  costPerTonneComparison: number | null;
  costPerTonneChangePercent: number | null;
}

export interface PeriodTotals {
  energyKwh: number | null;
  tonnesPoured: number | null;
  costPaise: number | null;
}

const pct = (a: number | null, b: number | null): number | null =>
  a === null || b === null || b === 0 ? null : (100 * (a - b)) / b;

/** energy_saving_kWh = baseline − comparison; energy_saving_% = 100 × saving / baseline */
export function savings(baseline: PeriodTotals, comparison: PeriodTotals): SavingsResult {
  const energySavingKwh =
    finite(baseline.energyKwh) && finite(comparison.energyKwh) ? baseline.energyKwh - comparison.energyKwh : null;
  const energySavingPercent =
    energySavingKwh !== null && finite(baseline.energyKwh) && baseline.energyKwh > 0
      ? (100 * energySavingKwh) / baseline.energyKwh
      : null;
  const costSavingPaise =
    finite(baseline.costPaise) && finite(comparison.costPaise) ? baseline.costPaise - comparison.costPaise : null;
  const costSavingPercent =
    costSavingPaise !== null && finite(baseline.costPaise) && baseline.costPaise > 0
      ? (100 * costSavingPaise) / baseline.costPaise
      : null;
  const secBaseline = specificEnergy(baseline.energyKwh, baseline.tonnesPoured);
  const secComparison = specificEnergy(comparison.energyKwh, comparison.tonnesPoured);
  const cptB = costPerTonne(baseline.costPaise, baseline.tonnesPoured);
  const cptC = costPerTonne(comparison.costPaise, comparison.tonnesPoured);
  return {
    energySavingKwh,
    energySavingPercent,
    costSavingPaise,
    costSavingPercent,
    secBaseline,
    secComparison,
    secChangePercent: pct(secComparison, secBaseline),
    costPerTonneBaseline: cptB,
    costPerTonneComparison: cptC,
    costPerTonneChangePercent: pct(cptC, cptB),
  };
}

export interface PaybackInput {
  /** Saving per operating day, ₹. May be zero or negative. */
  dailyCostSavingInr: number;
  operatingDaysPerYear: number;
  /** Share of the saving assumed to be realised, 0..1. */
  realisation: number;
  capexInr: number;
  opexInrPerYear: number;
}

export interface PaybackResult {
  annualGrossSavingInr: number;
  annualNetSavingInr: number;
  paybackMonths: number | null;
  status: "PAYS_BACK" | "NOT_RECOVERED" | "INVALID_INPUT";
  message: string;
  breakEvenRealisation: number | null;
}

/** Payback months = CAPEX ÷ ((annual saving − OPEX) / 12). Handles zero/negative net savings. */
export function payback(input: PaybackInput): PaybackResult {
  const { dailyCostSavingInr, operatingDaysPerYear, realisation, capexInr, opexInrPerYear } = input;
  const bad =
    ![dailyCostSavingInr, operatingDaysPerYear, realisation, capexInr, opexInrPerYear].every(finite) ||
    operatingDaysPerYear < 0 ||
    operatingDaysPerYear > 366 ||
    realisation < 0 ||
    realisation > 1 ||
    capexInr < 0 ||
    opexInrPerYear < 0;
  if (bad) {
    return {
      annualGrossSavingInr: 0,
      annualNetSavingInr: 0,
      paybackMonths: null,
      status: "INVALID_INPUT",
      message: "Check the inputs: days must be 0–366, realisation 0–100%, costs not negative.",
      breakEvenRealisation: null,
    };
  }
  const annualGross = dailyCostSavingInr * operatingDaysPerYear * realisation;
  const annualNet = annualGross - opexInrPerYear;
  const fullAnnual = dailyCostSavingInr * operatingDaysPerYear;
  const breakEvenRealisation = fullAnnual > 0 ? opexInrPerYear / fullAnnual : null;
  if (annualNet <= 0) {
    return {
      annualGrossSavingInr: annualGross,
      annualNetSavingInr: annualNet,
      paybackMonths: null,
      status: "NOT_RECOVERED",
      message:
        annualGross <= 0
          ? "No positive saving to recover the investment."
          : "The annual saving does not cover the running cost, so the investment is never recovered.",
      breakEvenRealisation,
    };
  }
  return {
    annualGrossSavingInr: annualGross,
    annualNetSavingInr: annualNet,
    paybackMonths: capexInr === 0 ? 0 : capexInr / (annualNet / 12),
    status: "PAYS_BACK",
    message: "Simple payback on the modelled net saving.",
    breakEvenRealisation,
  };
}
