import { DAY_MINUTES, localMinuteOfDay } from "./time";

export type TariffPeriodKind = "PEAK" | "SOLAR" | "OFFPEAK";

export interface TariffPeriod {
  kind: TariffPeriodKind;
  label: string;
  /** Local minute of day, inclusive. */
  startMin: number;
  /** Local minute of day, exclusive. A window with endMin <= startMin wraps past midnight. */
  endMin: number;
  /** Rate in paise per kWh. */
  ratePaise: number;
}

export interface TariffVersion {
  id: string;
  version: number;
  name: string;
  /** UTC ms from which this version applies. */
  effectiveFrom: number;
  timeZone: string;
  /** Rate outside every window, paise per kWh. */
  normalRatePaise: number;
  periods: TariffPeriod[];
}

export interface RateAt {
  ratePaise: number;
  kind: TariffPeriodKind | "NORMAL";
  label: string;
  versionId: string;
  version: number;
}

export function periodContains(p: Pick<TariffPeriod, "startMin" | "endMin">, minute: number): boolean {
  const s = p.startMin;
  const e = p.endMin;
  if (e === DAY_MINUTES) return minute >= s;
  if (s === e) return false;
  if (s < e) return minute >= s && minute < e;
  return minute >= s || minute < e; // wraps past midnight
}

export interface TariffValidationIssue {
  field: string;
  message: string;
}

/** Validate a set of periods: minutes in range, positive rates, no overlap. */
export function validatePeriods(normalRatePaise: number, periods: TariffPeriod[]): TariffValidationIssue[] {
  const issues: TariffValidationIssue[] = [];
  if (!Number.isFinite(normalRatePaise) || normalRatePaise <= 0) {
    issues.push({ field: "normalRate", message: "Normal rate must be greater than zero." });
  }
  const covered = new Array<number>(DAY_MINUTES).fill(-1);
  periods.forEach((p, i) => {
    if (!Number.isInteger(p.startMin) || p.startMin < 0 || p.startMin >= DAY_MINUTES) {
      issues.push({ field: `periods.${i}.start`, message: "Start must be a time between 00:00 and 23:59." });
      return;
    }
    if (!Number.isInteger(p.endMin) || p.endMin < 0 || p.endMin > DAY_MINUTES) {
      issues.push({ field: `periods.${i}.end`, message: "End must be a time between 00:00 and 24:00." });
      return;
    }
    if (p.startMin === p.endMin || (p.endMin === DAY_MINUTES && p.startMin === 0)) {
      issues.push({ field: `periods.${i}.end`, message: "A window must be shorter than a full day and longer than zero." });
      return;
    }
    if (!Number.isFinite(p.ratePaise) || p.ratePaise <= 0) {
      issues.push({ field: `periods.${i}.rate`, message: "Rate must be greater than zero." });
    }
    for (let m = 0; m < DAY_MINUTES; m++) {
      if (!periodContains(p, m)) continue;
      if (covered[m] !== -1) {
        issues.push({ field: `periods.${i}`, message: `Window ${i + 1} overlaps window ${covered[m] + 1}.` });
        return;
      }
      covered[m] = i;
    }
  });
  return issues;
}

/** Rate that applies at a local minute of day, for a single version. */
export function rateAtMinute(version: TariffVersion, minute: number): RateAt {
  for (const p of version.periods) {
    if (periodContains(p, minute)) {
      return { ratePaise: p.ratePaise, kind: p.kind, label: p.label, versionId: version.id, version: version.version };
    }
  }
  return { ratePaise: version.normalRatePaise, kind: "NORMAL", label: "Normal", versionId: version.id, version: version.version };
}

/** Pick the version in force at `ts` (latest effectiveFrom <= ts). */
export function versionAt(versions: TariffVersion[], ts: number): TariffVersion | null {
  let best: TariffVersion | null = null;
  for (const v of versions) {
    if (v.effectiveFrom <= ts && (!best || v.effectiveFrom > best.effectiveFrom || (v.effectiveFrom === best.effectiveFrom && v.version > best.version))) {
      best = v;
    }
  }
  return best;
}

/** Rate in force at a UTC instant; null when no tariff version covers it. */
export function rateAt(versions: TariffVersion[], ts: number): RateAt | null {
  const v = versionAt(versions, ts);
  if (!v) return null;
  return rateAtMinute(v, localMinuteOfDay(ts, v.timeZone));
}

/** Per-minute rate table (paise/kWh) for one local day under one version. */
export function minuteRateTable(version: TariffVersion): Float64Array {
  const arr = new Float64Array(DAY_MINUTES);
  for (let m = 0; m < DAY_MINUTES; m++) arr[m] = rateAtMinute(version, m).ratePaise;
  return arr;
}

/** Default illustrative tariff from the deck. All rates are ASSUMPTIONS. */
export function deckDefaultTariff(effectiveFrom: number, timeZone = "Asia/Kolkata"): Omit<TariffVersion, "id"> {
  return {
    version: 1,
    name: "Illustrative ToD tariff (deck assumption)",
    effectiveFrom,
    timeZone,
    normalRatePaise: 800,
    periods: [
      { kind: "SOLAR", label: "Solar hours (−20%)", startMin: 9 * 60, endMin: 17 * 60, ratePaise: 640 },
      { kind: "PEAK", label: "Evening peak (1.20×)", startMin: 18 * 60, endMin: 22 * 60, ratePaise: 960 },
    ],
  };
}
