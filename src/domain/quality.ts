/**
 * Meter data quality: validation of individual readings, duplicate and gap
 * detection, completeness, freshness and energy that is not linked to any heat.
 */

export type ReadingQuality = "OK" | "SUSPECT" | "INVALID";

export interface RawReading {
  ts: number;
  powerKw: number | null;
  energyKwh: number | null;
}

export interface ReadingLimits {
  /** Furnace rated power; readings far above it are suspect. */
  ratedKw: number;
  intervalSeconds: number;
}

export function classifyReading(r: RawReading, limits: ReadingLimits): { quality: ReadingQuality; reason: string | null } {
  const { powerKw, energyKwh } = r;
  if (powerKw === null && energyKwh === null) return { quality: "INVALID", reason: "No power or energy value." };
  if (powerKw !== null && (!Number.isFinite(powerKw) || powerKw < 0)) return { quality: "INVALID", reason: "Power must be zero or positive." };
  if (energyKwh !== null && (!Number.isFinite(energyKwh) || energyKwh < 0)) return { quality: "INVALID", reason: "Energy must be zero or positive." };
  const ceiling = limits.ratedKw * 1.25;
  if (powerKw !== null && powerKw > ceiling * 2) return { quality: "INVALID", reason: `Power above twice the plausible ceiling (${Math.round(ceiling)} kW).` };
  if (powerKw !== null && powerKw > ceiling) return { quality: "SUSPECT", reason: `Power above 125% of rated ${limits.ratedKw} kW.` };
  if (powerKw !== null && energyKwh !== null) {
    const implied = (powerKw * limits.intervalSeconds) / 3600;
    const tol = Math.max(0.5, implied * 0.15);
    if (Math.abs(implied - energyKwh) > tol) return { quality: "SUSPECT", reason: "Energy and power disagree by more than 15%." };
  }
  return { quality: "OK", reason: null };
}

/** Fill the missing one of power/energy from the other. */
export function completeReading(r: RawReading, intervalSeconds: number): { powerKw: number; energyKwh: number } | null {
  if (r.powerKw !== null && r.energyKwh !== null) return { powerKw: r.powerKw, energyKwh: r.energyKwh };
  if (r.powerKw !== null) return { powerKw: r.powerKw, energyKwh: (r.powerKw * intervalSeconds) / 3600 };
  if (r.energyKwh !== null) return { powerKw: (r.energyKwh * 3600) / intervalSeconds, energyKwh: r.energyKwh };
  return null;
}

export interface Gap {
  from: number;
  to: number;
  missingIntervals: number;
}

/**
 * Find missing intervals inside [windowStart, windowEnd). `timestamps` must be
 * sorted ascending and unique. A reading is expected every intervalSeconds.
 */
export function findGaps(timestamps: number[], windowStart: number, windowEnd: number, intervalSeconds: number): Gap[] {
  const step = intervalSeconds * 1000;
  const gaps: Gap[] = [];
  let expected = windowStart;
  for (const ts of timestamps) {
    if (ts < windowStart || ts >= windowEnd) continue;
    if (ts - expected >= step) {
      const missing = Math.round((ts - expected) / step);
      if (missing > 0) gaps.push({ from: expected, to: ts, missingIntervals: missing });
    }
    expected = Math.max(expected, ts + step);
  }
  if (windowEnd - expected >= step) {
    gaps.push({ from: expected, to: windowEnd, missingIntervals: Math.round((windowEnd - expected) / step) });
  }
  return gaps;
}

export function completeness(readingCount: number, windowStart: number, windowEnd: number, intervalSeconds: number): number | null {
  const expected = Math.floor((windowEnd - windowStart) / (intervalSeconds * 1000));
  if (expected <= 0) return null;
  return Math.min(1, readingCount / expected);
}

export type Freshness = "FRESH" | "STALE" | "NO_DATA";

export function freshness(lastTs: number | null, now: number, intervalSeconds: number): { status: Freshness; ageSeconds: number | null } {
  if (lastTs === null) return { status: "NO_DATA", ageSeconds: null };
  const age = Math.max(0, (now - lastTs) / 1000);
  return { status: age <= intervalSeconds * 5 ? "FRESH" : "STALE", ageSeconds: age };
}

/** Group rows by timestamp and report duplicates (same meter, same timestamp). */
export function findDuplicateTimestamps<T extends { ts: number }>(rows: T[]): Map<number, T[]> {
  const byTs = new Map<number, T[]>();
  for (const r of rows) {
    const list = byTs.get(r.ts);
    if (list) list.push(r);
    else byTs.set(r.ts, [r]);
  }
  const dups = new Map<number, T[]>();
  for (const [ts, list] of byTs) if (list.length > 1) dups.set(ts, list);
  return dups;
}

export interface HeatWindow {
  id: string;
  start: number;
  /** End of the heat's metered window (tap). */
  end: number;
}

export interface LinkResult {
  linkedKwh: number;
  unlinkedKwh: number;
  /** Unlinked readings above the idle threshold, merged into contiguous spans. */
  unlinkedSpans: { from: number; to: number; kwh: number; peakKw: number }[];
  perHeatKwh: Map<string, number>;
  perHeatReadings: Map<string, number>;
}

/**
 * Associate readings with heats by time window. Energy outside every heat window
 * and above the idle threshold is "unlinked": the meter saw it but no heat in the
 * log explains it.
 */
export function linkReadingsToHeats(
  readings: { ts: number; powerKw: number; energyKwh: number }[],
  heats: HeatWindow[],
  intervalSeconds: number,
  idleThresholdKw = 5,
): LinkResult {
  const sortedHeats = [...heats].sort((a, b) => a.start - b.start);
  const perHeatKwh = new Map<string, number>();
  const perHeatReadings = new Map<string, number>();
  let linked = 0;
  let unlinked = 0;
  const spans: LinkResult["unlinkedSpans"] = [];
  const step = intervalSeconds * 1000;
  let h = 0;
  for (const r of readings) {
    while (h < sortedHeats.length && sortedHeats[h].end <= r.ts) h++;
    const heat = h < sortedHeats.length && sortedHeats[h].start <= r.ts && r.ts < sortedHeats[h].end ? sortedHeats[h] : null;
    if (heat) {
      linked += r.energyKwh;
      perHeatKwh.set(heat.id, (perHeatKwh.get(heat.id) ?? 0) + r.energyKwh);
      perHeatReadings.set(heat.id, (perHeatReadings.get(heat.id) ?? 0) + 1);
    } else {
      unlinked += r.energyKwh;
      if (r.powerKw > idleThresholdKw) {
        const last = spans[spans.length - 1];
        if (last && r.ts - last.to <= step) {
          last.to = r.ts + step;
          last.kwh += r.energyKwh;
          last.peakKw = Math.max(last.peakKw, r.powerKw);
        } else {
          spans.push({ from: r.ts, to: r.ts + step, kwh: r.energyKwh, peakKw: r.powerKw });
        }
      }
    }
  }
  return { linkedKwh: linked, unlinkedKwh: unlinked, unlinkedSpans: spans, perHeatKwh, perHeatReadings };
}
