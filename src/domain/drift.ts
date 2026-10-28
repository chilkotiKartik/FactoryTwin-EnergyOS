/**
 * Gradual drift in furnace efficiency (lining wear, coil or capacitor problems)
 * shows up as heats slowly using more energy than the model expects, day after
 * day, without any single heat crossing the anomaly threshold. A two-sided
 * tabular CUSUM on daily mean residuals detects that kind of sustained shift.
 *
 *   residual% (heat) = 100 × (metered − predicted incl. holding) / predicted
 *   day value        = mean residual% of the day's complete heats
 *   S⁺_t = max(0, S⁺_{t−1} + x_t − μ₀ − k),  S⁻_t = max(0, S⁻_{t−1} − x_t + μ₀ − k)
 *   alarm when S > h.  k = 0.5σ, h = 5σ, μ₀ and σ from the first `baselineDays` (robust).
 */

export interface DailyResidual {
  day: string;
  residualPct: number;
  heats: number;
}

export type DriftStatus = "STABLE" | "DRIFT_UP" | "DRIFT_DOWN" | "INSUFFICIENT";

export interface DriftResult {
  status: DriftStatus;
  /** First day of the run of days that led to the alarm. */
  since: string | null;
  /** Mean residual since the shift began minus the baseline mean, percentage points. */
  shiftPct: number | null;
  baselineMeanPct: number | null;
  sigmaPct: number | null;
  series: { day: string; residualPct: number; up: number; down: number }[];
  message: string;
}

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function detectDrift(points: DailyResidual[], opts: { baselineDays?: number; minDays?: number } = {}): DriftResult {
  const baselineDays = opts.baselineDays ?? 10;
  const minDays = opts.minDays ?? baselineDays + 5;
  const pts = points.filter((p) => Number.isFinite(p.residualPct) && p.heats > 0).sort((a, b) => (a.day < b.day ? -1 : 1));
  const empty = { since: null, shiftPct: null, baselineMeanPct: null, sigmaPct: null, series: [] };
  if (pts.length < minDays) return { status: "INSUFFICIENT", ...empty, message: `Needs at least ${minDays} days with complete metered heats; ${pts.length} available.` };
  const base = pts.slice(0, baselineDays).map((p) => p.residualPct);
  const mu = median(base);
  // Robust σ, floored at 1%: daily SEC naturally varies by about that much, and a
  // shift smaller than that is not worth an alarm.
  const sigma = Math.max(1, 1.4826 * median(base.map((x) => Math.abs(x - mu))));
  const k = 0.5 * sigma;
  const h = 5 * sigma;
  let up = 0;
  let down = 0;
  let upStart = 0;
  let downStart = 0;
  const series: DriftResult["series"] = [];
  pts.forEach((p, i) => {
    const x = p.residualPct - mu;
    if (up === 0) upStart = i;
    if (down === 0) downStart = i;
    up = Math.max(0, up + x - k);
    down = Math.max(0, down - x - k);
    series.push({ day: p.day, residualPct: p.residualPct, up, down });
  });
  // The verdict is the state on the latest day: a shift that has since reversed is not reported.
  const a = up > h ? { dir: "UP" as const, start: upStart } : down > h ? { dir: "DOWN" as const, start: downStart } : null;
  if (!a) return { status: "STABLE", since: null, shiftPct: null, baselineMeanPct: mu, sigmaPct: sigma, series, message: `No sustained shift: daily residuals stay within the expected spread (σ ${sigma.toFixed(1)}%).` };
  const run = pts.slice(a.start).map((p) => p.residualPct);
  const shift = run.reduce((s, v) => s + v, 0) / run.length - mu;
  const since = pts[a.start].day;
  return {
    status: a.dir === "UP" ? "DRIFT_UP" : "DRIFT_DOWN",
    since,
    shiftPct: shift,
    baselineMeanPct: mu,
    sigmaPct: sigma,
    series,
    message:
      a.dir === "UP"
        ? `Heats have used about ${shift.toFixed(1)}% more energy than expected since ${since}. Check lining condition, coil cooling and capacitor bank.`
        : `Heats have used about ${Math.abs(shift).toFixed(1)}% less energy than expected since ${since}. If nothing improved on purpose, check the meter and the heat log.`,
  };
}
