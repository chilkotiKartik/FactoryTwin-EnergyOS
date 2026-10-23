/**
 * Deterministic synthetic foundry simulator. Everything it produces is SIMULATED.
 *
 * One induction furnace. Each heat: full-power melt, then (if its mould set is
 * not ready) a low holding plateau, then tap. Power is off during the
 * tap-and-recharge turnaround (ASSUMPTION). Readings are 1-minute power and
 * interval energy for the whole local day.
 */

import { localToUtc, MINUTE_MS } from "./time";

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Approximately normal noise from a uniform generator (Irwin–Hall, 6 terms). */
export function gaussian(rand: () => number): number {
  let s = 0;
  for (let i = 0; i < 6; i++) s += rand();
  return (s - 3) / Math.sqrt(0.5);
}

export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface FurnaceSimParams {
  capacityKg: number;
  ratedKw: number;
  nominalMeltMinutes: number;
  coldExtraMinutes: number;
  coldGapMinutes: number;
  turnaroundMinutes: number;
  holdingKw: number;
  /** Relative standard deviation of melt power, per minute. */
  powerNoise: number;
}

export const DEFAULT_SIM_PARAMS: FurnaceSimParams = {
  capacityKg: 500,
  ratedKw: 550,
  nominalMeltMinutes: 35,
  coldExtraMinutes: 5,
  coldGapMinutes: 60,
  turnaroundMinutes: 10,
  holdingKw: 60,
  powerNoise: 0.006,
};

export interface SimHeatPlan {
  heatNo: string;
  chargeKg: number;
  pouredKg: number;
  mouldSet: number;
  /** Local minute when the mould set is ready. */
  mouldReadyMin: number;
  orderCode: string | null;
}

export type ExecutionRule =
  | { kind: "CURRENT_PRACTICE"; startMin: number }
  | { kind: "FIXED_STARTS"; startsMin: number[] };

export interface SimHeatResult extends SimHeatPlan {
  startMin: number;
  meltEndMin: number;
  tapMin: number;
  holdMin: number;
  cold: boolean;
  energyKwh: number;
}

export interface SimReading {
  minute: number;
  powerKw: number;
  energyKwh: number;
}

export interface SimDay {
  date: string;
  heats: SimHeatResult[];
  readings: SimReading[];
}

export function simulateDay(
  date: string,
  plan: SimHeatPlan[],
  rule: ExecutionRule,
  params: FurnaceSimParams,
  seed: number,
): SimDay {
  const rand = mulberry32(seed);
  const power = new Float64Array(1440);
  const heats: SimHeatResult[] = [];
  let prevTap: number | null = null;
  plan.forEach((h, k) => {
    let S: number;
    if (rule.kind === "CURRENT_PRACTICE") S = prevTap === null ? rule.startMin : prevTap + params.turnaroundMinutes;
    else S = Math.max(rule.startsMin[k], prevTap === null ? 0 : prevTap + params.turnaroundMinutes);
    const cold = prevTap === null || S - prevTap > params.coldGapMinutes;
    const melt = Math.ceil((params.nominalMeltMinutes * h.chargeKg) / params.capacityKg - 1e-9) + (cold ? params.coldExtraMinutes : 0);
    const M = S + melt;
    const tap = Math.max(M, h.mouldReadyMin);
    let kwh = 0;
    for (let m = S; m < M && m < 1440; m++) {
      const kw = params.ratedKw * (1 + params.powerNoise * gaussian(rand));
      power[m] = kw;
      kwh += kw / 60;
    }
    for (let m = M; m < tap && m < 1440; m++) {
      const kw = params.holdingKw + 1.5 * gaussian(rand);
      power[m] = kw;
      kwh += kw / 60;
    }
    heats.push({ ...h, startMin: S, meltEndMin: M, tapMin: tap, holdMin: tap - M, cold, energyKwh: kwh });
    prevTap = tap;
  });
  const readings: SimReading[] = [];
  for (let m = 0; m < 1440; m++) {
    const kw = Math.max(0, Math.round(power[m] * 100) / 100);
    readings.push({ minute: m, powerKw: kw, energyKwh: Math.round((kw / 60) * 10000) / 10000 });
  }
  // Recompute heat energy from the rounded readings so totals match the meter exactly.
  for (const h of heats) {
    h.energyKwh = readings.slice(h.startMin, Math.min(1440, h.tapMin)).reduce((s, r) => s + r.energyKwh, 0);
  }
  return { date, heats, readings };
}

export function readingTimestamps(day: SimDay, timeZone: string): { ts: number; powerKw: number; energyKwh: number }[] {
  const start = localToUtc(day.date, 0, timeZone);
  return day.readings.map((r) => ({ ts: start + r.minute * MINUTE_MS, powerKw: r.powerKw, energyKwh: r.energyKwh }));
}
