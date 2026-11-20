/**
 * Statistics for a selected time window of a day's 1-minute furnace trace.
 * Pure: used by the energy timeline's window inspector and unit-tested.
 */
export interface WindowPoint {
  m: number;
  kw: number | null;
}
export interface WindowBand {
  startMin: number;
  endMin: number;
  kind: string;
  ratePaise: number;
}
export interface WindowHeat {
  startMin: number;
  meltEndMin: number | null;
  tapMin: number | null;
}

export interface WindowStats {
  fromMin: number;
  toMin: number;
  minutes: number;
  /** Minutes with a reading. */
  coveredMinutes: number;
  kwh: number;
  /** Energy cost at the tariff bands given, paise. Null when no band covers a measured minute. */
  costPaise: number | null;
  kwhByKind: Record<string, number>;
  avgKw: number | null;
  peakKw: number | null;
  /** Minutes inside the window during which a heat was holding (melt end to tap). */
  holdingMinutes: number;
  heatsTouched: number;
}

export function windowStats(points: WindowPoint[], bands: WindowBand[], heats: WindowHeat[], a: number, b: number): WindowStats {
  const fromMin = Math.max(0, Math.min(a, b));
  const toMin = Math.min(1440, Math.max(a, b));
  let kwh = 0;
  let cost = 0;
  let costKnown = true;
  let covered = 0;
  let peak: number | null = null;
  const kwhByKind: Record<string, number> = {};
  const byMinute = new Map<number, number | null>();
  for (const p of points) byMinute.set(p.m, p.kw);
  for (let m = fromMin; m < toMin; m++) {
    const kw = byMinute.get(m);
    if (kw === null || kw === undefined) continue;
    covered++;
    const e = kw / 60;
    kwh += e;
    peak = peak === null ? kw : Math.max(peak, kw);
    const band = bands.find((x) => m >= x.startMin && m < x.endMin);
    if (!band) {
      costKnown = false;
      continue;
    }
    cost += e * band.ratePaise;
    kwhByKind[band.kind] = (kwhByKind[band.kind] ?? 0) + e;
  }
  let holding = 0;
  let touched = 0;
  for (const h of heats) {
    if (h.tapMin === null) continue;
    if (h.startMin < toMin && h.tapMin > fromMin) touched++;
    if (h.meltEndMin !== null && h.tapMin > h.meltEndMin) holding += Math.max(0, Math.min(h.tapMin, toMin) - Math.max(h.meltEndMin, fromMin));
  }
  return {
    fromMin,
    toMin,
    minutes: toMin - fromMin,
    coveredMinutes: covered,
    kwh,
    costPaise: covered && costKnown ? cost : covered ? null : 0,
    kwhByKind,
    avgKw: covered ? (kwh * 60) / covered : null,
    peakKw: peak,
    holdingMinutes: holding,
    heatsTouched: touched,
  };
}
