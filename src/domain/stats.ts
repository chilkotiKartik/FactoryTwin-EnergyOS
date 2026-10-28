/** Small statistics helpers for savings verification. */

export const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;

export function sampleVariance(v: number[]): number {
  if (v.length < 2) return 0;
  const m = mean(v);
  return v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1);
}

/** Two-sided Student t quantile for 90% confidence (Cornish–Fisher expansion; within 1% for df ≥ 3). */
export function t90(df: number): number {
  const z = 1.6448536;
  if (!Number.isFinite(df) || df > 1e6) return z;
  const d = Math.max(1, df);
  return z + (z ** 3 + z) / (4 * d) + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * d * d) + (3 * z ** 7 + 19 * z ** 5 + 17 * z ** 3 - 15 * z) / (384 * d ** 3);
}

export interface DiffInterval {
  /** comparison mean − baseline mean */
  diff: number;
  low: number;
  high: number;
  df: number;
  method: "WELCH" | "POOLED";
  /** The interval excludes zero. */
  significant: boolean;
}

/**
 * 90% interval for the difference of two means. Welch when both samples have at
 * least two values; otherwise the baseline's spread is assumed for the single
 * comparison value (pooled). Null when there is no spread to estimate.
 */
export function diffInterval(baseline: number[], comparison: number[]): DiffInterval | null {
  if (!baseline.length || !comparison.length) return null;
  const nb = baseline.length;
  const nc = comparison.length;
  const vb = sampleVariance(baseline);
  const vc = sampleVariance(comparison);
  const diff = mean(comparison) - mean(baseline);
  let se: number;
  let df: number;
  let method: DiffInterval["method"];
  if (nb >= 2 && nc >= 2) {
    se = Math.sqrt(vb / nb + vc / nc);
    df = (vb / nb + vc / nc) ** 2 / ((vb / nb) ** 2 / (nb - 1) + (vc / nc) ** 2 / (nc - 1) || 1e-12);
    method = "WELCH";
  } else {
    const v = nb >= 2 ? vb : vc;
    df = nb >= 2 ? nb - 1 : nc - 1;
    if (df < 1) return null;
    se = Math.sqrt(v * (1 / nb + 1 / nc));
    method = "POOLED";
  }
  if (!(se > 0)) return null;
  const half = t90(df) * se;
  return { diff, low: diff - half, high: diff + half, df, method, significant: diff - half > 0 || diff + half < 0 };
}

/** Coefficient of variation, % (spread of the baseline relative to its mean). */
export function cvPercent(v: number[]): number | null {
  if (v.length < 2) return null;
  const m = mean(v);
  return m === 0 ? null : (100 * Math.sqrt(sampleVariance(v))) / Math.abs(m);
}
