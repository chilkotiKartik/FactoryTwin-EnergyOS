/**
 * Savings potential: a transparent, deliberately simple estimate of what better
 * timing could be worth to a plant. Two levers only, both from the product's own
 * method: (1) avoid holding energy, (2) move melting into cheaper solar hours.
 * Every output is MODELLED; nothing here is a measured or verified saving.
 */
export interface SavingsInput {
  /** Tonnes poured per month. */
  tonnesPerMonth: number;
  /** Specific energy now, kWh per tonne. */
  secKwhPerT: number;
  /** Share of metered kWh spent holding metal at temperature, %. */
  holdingPct: number;
  /** Share of that holding energy better timing can remove, %. */
  holdingRecoverablePct: number;
  /** Share of the remaining melting kWh that can move into solar hours, %. */
  shiftablePct: number;
  /** Normal energy rate, ₹/kWh. */
  normalRate: number;
  /** Solar-hour discount on the normal rate, %. */
  solarDiscountPct: number;
  /** Grid emission factor, kg CO₂ per kWh. */
  emissionFactor: number;
  /** One-off cost of the system, ₹. */
  capexRupees: number;
  /** Running cost, ₹ per month. */
  opexRupeesPerMonth: number;
}

export interface SavingsResult {
  kwhPerMonth: number;
  kwhSavedPerMonth: number;
  secAfter: number | null;
  rupeesFromHoldingPerMonth: number;
  rupeesFromShiftPerMonth: number;
  rupeesSavedPerMonth: number;
  netRupeesPerMonth: number;
  rupeesSavedPerYear: number;
  co2TonnesPerYear: number;
  /** Months to recover capex from net monthly savings; null when net saving is not positive. */
  paybackMonths: number | null;
}

const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);

export function estimateSavings(raw: SavingsInput): SavingsResult {
  const i = {
    tonnes: clamp(raw.tonnesPerMonth, 0, 1e7),
    sec: clamp(raw.secKwhPerT, 0, 1e5),
    holding: clamp(raw.holdingPct, 0, 100) / 100,
    recoverable: clamp(raw.holdingRecoverablePct, 0, 100) / 100,
    shiftable: clamp(raw.shiftablePct, 0, 100) / 100,
    rate: clamp(raw.normalRate, 0, 1000),
    discount: clamp(raw.solarDiscountPct, 0, 100) / 100,
    ef: clamp(raw.emissionFactor, 0, 5),
    capex: clamp(raw.capexRupees, 0, 1e10),
    opex: clamp(raw.opexRupeesPerMonth, 0, 1e9),
  };
  const kwhPerMonth = i.tonnes * i.sec;
  const kwhSaved = kwhPerMonth * i.holding * i.recoverable;
  const fromHolding = kwhSaved * i.rate;
  const fromShift = (kwhPerMonth - kwhSaved) * i.shiftable * i.rate * i.discount;
  const saved = fromHolding + fromShift;
  const net = saved - i.opex;
  return {
    kwhPerMonth,
    kwhSavedPerMonth: kwhSaved,
    secAfter: i.tonnes > 0 ? (kwhPerMonth - kwhSaved) / i.tonnes : null,
    rupeesFromHoldingPerMonth: fromHolding,
    rupeesFromShiftPerMonth: fromShift,
    rupeesSavedPerMonth: saved,
    netRupeesPerMonth: net,
    rupeesSavedPerYear: saved * 12,
    co2TonnesPerYear: (kwhSaved * 12 * i.ef) / 1000,
    paybackMonths: net > 0 ? i.capex / net : null,
  };
}
