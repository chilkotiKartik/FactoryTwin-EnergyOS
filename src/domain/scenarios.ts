import { addDays } from "./time";
import { DEFAULT_SIM_PARAMS, gaussian, mulberry32, type SimHeatPlan } from "./simulator";

/**
 * Synthetic demonstration scenarios. All data generated from these definitions is
 * SIMULATED and must be labelled as such.
 */

export const SCENARIO_KEYS = ["baseline-shift", "holding-anomaly", "tariff-optimization", "missing-readings", "infeasible"] as const;
export type ScenarioKey = (typeof SCENARIO_KEYS)[number];

export const AS_RUN_DATE = "2026-10-20";
export const PLAN_DATE = "2026-10-21";
export const HISTORY_DAYS = 30;
export const BASE_SEED = 20261020;

/** Deck figures, kept for side-by-side comparison only. Never displayed as computed results. */
export const DECK_REFERENCE = {
  baselineKwh: 4052,
  baselineSec: 675.4,
  baselineCostPerTonne: 4632,
  optimisedKwh: 3914,
  optimisedSec: 652.4,
  optimisedCostPerTonne: 4290,
  secChangePct: -3.4,
  costPerTonneChangePct: -7.4,
  tonnes: 6.0,
  heat07ActualKwh: 366,
  heat07ExpectedKwh: 320,
  heat07HoldMinutes: 45,
  totalHoldMinutes: 138,
  recommendedStart: "08:50",
  lastTapBaseline: "17:15",
  lastTapRecommended: "17:47",
  solarShareBaselinePct: 71,
  solarShareRecommendedPct: 89,
  co2PerTonneBaseline: 491,
  co2PerTonneRecommended: 474,
} as const;

/**
 * Mould-ready times (local minutes) for the deck's as-run day. With a 06:00 start
 * and immediate recharge, metal waits 138 min in total, 45 min of it on heat 07
 * (mould set 7). Starting at 08:50 removes every wait.
 */
export const DECK_MOULD_READY = [408, 470, 530, 585, 640, 698, 788, 840, 885, 938, 988, 1020];

/** Mould line that keeps up with a 06:00 start (no holding). */
export const CLEAN_MOULD_READY = Array.from({ length: 12 }, (_, k) => 400 + 45 * k - 5);

export interface PlanOrderDef {
  code: string;
  grade: string;
  requiredTonnes: number;
  /** Heat indexes (0-based) assigned to this order. */
  heats: number[];
  dueMin: number;
}

export interface ScenarioDef {
  key: ScenarioKey;
  name: string;
  summary: string;
  purpose: string;
  asRunMould: number[];
  planMould: number[];
  planDeadlineMin: number;
  planDowntime: { fromMin: number; toMin: number; reason: string }[];
  orders: PlanOrderDef[];
  meterDefects: null | {
    gap: { fromMin: number; toMin: number };
    unlinked: { fromMin: number; toMin: number; kw: number };
  };
}

const ORDERS_STANDARD = (dueA: number, dueB: number): PlanOrderDef[] => [
  { code: "PO-2611", grade: "FG260 grey iron", requiredTonnes: 3.5, heats: [0, 1, 2, 3, 4, 5, 6], dueMin: dueA },
  { code: "PO-2614", grade: "SG500/7 ductile", requiredTonnes: 2.5, heats: [7, 8, 9, 10, 11], dueMin: dueB },
];

export const SCENARIOS: Record<ScenarioKey, ScenarioDef> = {
  "baseline-shift": {
    key: "baseline-shift",
    name: "Baseline shift",
    summary: "A normal day: the moulding line keeps up, so there is almost no holding.",
    purpose: "Shows how heat-level baselines and SEC are built. With an early dispatch cut-off the optimiser has little room, and says so.",
    asRunMould: CLEAN_MOULD_READY,
    planMould: CLEAN_MOULD_READY,
    planDeadlineMin: 16 * 60 + 30,
    planDowntime: [],
    orders: ORDERS_STANDARD(16 * 60 + 30, 16 * 60 + 30),
    meterDefects: null,
  },
  "holding-anomaly": {
    key: "holding-anomaly",
    name: "Holding-energy anomaly",
    summary: "The deck's as-run day: metal waits 138 min for moulds; Heat 07 holds 45 min.",
    purpose: "Main demo. Detect and explain Heat 07, then remove holding and shift melting into solar hours.",
    asRunMould: DECK_MOULD_READY,
    planMould: DECK_MOULD_READY,
    planDeadlineMin: 22 * 60,
    planDowntime: [],
    orders: ORDERS_STANDARD(22 * 60, 22 * 60),
    meterDefects: null,
  },
  "tariff-optimization": {
    key: "tariff-optimization",
    name: "Tariff optimisation",
    summary: "No holding problem; the only lever is when melting happens.",
    purpose: "Shows that moving load into cheaper hours lowers cost without lowering kWh.",
    asRunMould: CLEAN_MOULD_READY,
    planMould: CLEAN_MOULD_READY,
    planDeadlineMin: 22 * 60,
    planDowntime: [],
    orders: ORDERS_STANDARD(22 * 60, 22 * 60),
    meterDefects: null,
  },
  "missing-readings": {
    key: "missing-readings",
    name: "Missing meter readings",
    summary: "The meter drops out for 25 min during Heat 09, and 40 min of energy before the shift is not linked to any heat.",
    purpose: "Shows gap detection, unlinked energy and that advice pauses when data completeness is too low.",
    asRunMould: DECK_MOULD_READY,
    planMould: DECK_MOULD_READY,
    planDeadlineMin: 22 * 60,
    planDowntime: [],
    orders: ORDERS_STANDARD(22 * 60, 22 * 60),
    meterDefects: {
      gap: { fromMin: 14 * 60 + 15, toMin: 14 * 60 + 40 },
      unlinked: { fromMin: 4 * 60 + 30, toMin: 5 * 60 + 10, kw: 38 },
    },
  },
  infeasible: {
    key: "infeasible",
    name: "Infeasible constraints",
    summary: "A 15:30 dispatch cut-off plus lining inspection 11:00–13:00.",
    purpose: "Shows that the optimiser reports infeasibility and names the blocking limits instead of relaxing them.",
    asRunMould: DECK_MOULD_READY,
    planMould: DECK_MOULD_READY,
    planDeadlineMin: 15 * 60 + 30,
    planDowntime: [{ fromMin: 11 * 60, toMin: 13 * 60, reason: "Lining inspection" }],
    orders: ORDERS_STANDARD(15 * 60 + 30, 15 * 60 + 30),
    meterDefects: null,
  },
};

export function heatNo(k: number): string {
  return `H${String(k + 1).padStart(2, "0")}`;
}

export function dayPlan(mould: number[], orders: PlanOrderDef[], chargeKg: number[] | number = 500): SimHeatPlan[] {
  return mould.map((m, k) => {
    const c = Array.isArray(chargeKg) ? chargeKg[k] : chargeKg;
    return {
      heatNo: heatNo(k),
      chargeKg: c,
      pouredKg: c,
      mouldSet: k + 1,
      mouldReadyMin: m,
      orderCode: orders.find((o) => o.heats.includes(k))?.code ?? null,
    };
  });
}

/** History: 30 days of current-practice operation with random mould delays and charge sizes. */
export function historyPlans(): { date: string; plan: SimHeatPlan[]; seed: number }[] {
  const rand = mulberry32(BASE_SEED);
  const out: { date: string; plan: SimHeatPlan[]; seed: number }[] = [];
  const p = DEFAULT_SIM_PARAMS;
  for (let d = HISTORY_DAYS; d >= 1; d--) {
    const date = addDays(AS_RUN_DATE, -d);
    const charges = Array.from({ length: 12 }, () => 450 + 10 * Math.floor(rand() * 6));
    // Mould-ready times follow the current-practice cadence with random delays.
    const mould: number[] = [];
    let prevTap: number | null = null;
    for (let k = 0; k < 12; k++) {
      const S = prevTap === null ? 360 : prevTap + p.turnaroundMinutes;
      const melt = Math.ceil((p.nominalMeltMinutes * charges[k]) / p.capacityKg - 1e-9) + (prevTap === null ? p.coldExtraMinutes : 0);
      const M = S + melt;
      const r = rand();
      const delay = r < 0.5 ? 0 : r < 0.9 ? Math.round(3 + rand() * 20) : Math.round(25 + Math.abs(gaussian(rand)) * 15);
      const ready = M + delay - (delay === 0 ? 5 : 0);
      mould.push(ready);
      prevTap = Math.max(M, ready);
    }
    out.push({
      date,
      plan: dayPlan(mould, ORDERS_STANDARD(1320, 1320), charges),
      seed: BASE_SEED + d * 7919,
    });
  }
  return out;
}
