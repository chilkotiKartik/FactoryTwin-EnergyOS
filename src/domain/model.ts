/**
 * Expected-energy model for a heat.
 *
 *   kWh ≈ b0 + b1·charge_t + b2·cold_start + b3·hold_min
 *
 * Fitted by robust (Huber) least squares on past heats. "Expected under good practice"
 * is the prediction with hold_min set to zero, so the variance against it is the
 * avoidable part that the meter and heat log can explain. When there is not
 * enough history, a physics prior is used instead (rated kW × nominal melt time
 * scaled by charge), and the model says so.
 */

export const MODEL_VERSION = "heat-energy-huber-v2";

export interface HeatFeatures {
  chargeTonnes: number;
  coldStart: boolean;
  holdMinutes: number;
}

export interface FitRow extends HeatFeatures {
  kwh: number;
}

export interface EnergyModel {
  version: string;
  kind: "OLS" | "PHYSICS_PRIOR";
  coefficients: { intercept: number; perTonne: number; coldStart: number; perHoldMinute: number };
  n: number;
  r2: number | null;
  rmseKwh: number | null;
  /** Residual standard deviation with hold removed: used for anomaly thresholds. */
  note: string;
}

function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-9) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

export function physicsPrior(ratedKw: number, nominalMeltMinutes: number, capacityTonnes: number, coldExtraMinutes: number, holdingKw: number): EnergyModel {
  const warm = (ratedKw * nominalMeltMinutes) / 60;
  return {
    version: MODEL_VERSION,
    kind: "PHYSICS_PRIOR",
    coefficients: {
      intercept: 0,
      perTonne: warm / capacityTonnes,
      coldStart: (ratedKw * coldExtraMinutes) / 60,
      perHoldMinute: holdingKw / 60,
    },
    n: 0,
    r2: null,
    rmseKwh: null,
    note: "Not enough clean history to fit; using rated power × nominal melt time.",
  };
}

const MIN_ROWS = 24;
const P = 4;
const HUBER_K = 1.345;

function weightedSolve(X: number[][], y: number[], w: number[]): number[] | null {
  const XtX = Array.from({ length: P }, () => new Array<number>(P).fill(0));
  const Xty = new Array<number>(P).fill(0);
  for (let i = 0; i < X.length; i++) {
    for (let a = 0; a < P; a++) {
      Xty[a] += w[i] * X[i][a] * y[i];
      for (let b = 0; b < P; b++) XtX[a][b] += w[i] * X[i][a] * X[i][b];
    }
  }
  const beta = solve(XtX, Xty);
  return beta && beta.every(Number.isFinite) ? beta : null;
}

function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Robust linear fit (Huber M-estimator by iteratively reweighted least squares).
 * Heats with large residuals, such as the anomalies being looked for, get less
 * weight, so a few bad heats cannot pull the "expected" baseline towards them.
 * RMSE is the robust residual scale (1.4826 × MAD), used for anomaly thresholds.
 */
export function fitModel(rows: FitRow[], prior: EnergyModel): EnergyModel {
  const clean = rows.filter(
    (r) => Number.isFinite(r.kwh) && r.kwh > 0 && Number.isFinite(r.chargeTonnes) && r.chargeTonnes > 0 && Number.isFinite(r.holdMinutes) && r.holdMinutes >= 0,
  );
  if (clean.length < MIN_ROWS) return { ...prior, n: clean.length };
  const X = clean.map((r) => [1, r.chargeTonnes, r.coldStart ? 1 : 0, r.holdMinutes]);
  const y = clean.map((r) => r.kwh);
  let w = new Array<number>(X.length).fill(1);
  let beta = weightedSolve(X, y, w);
  if (!beta) return { ...prior, n: clean.length, note: "History does not vary enough to fit every term; using the physics prior." };
  const resid = (b: number[]) => X.map((x, i) => y[i] - x.reduce((s, v, k) => s + v * b[k], 0));
  let scale = 0;
  for (let iter = 0; iter < 30; iter++) {
    const r = resid(beta);
    scale = 1.4826 * median(r.map(Math.abs));
    if (scale < 1e-9) break;
    w = r.map((e) => Math.min(1, (HUBER_K * scale) / Math.max(Math.abs(e), 1e-12)));
    const next = weightedSolve(X, y, w);
    if (!next) break;
    const moved = next.some((v, k) => Math.abs(v - beta![k]) > 1e-6 * Math.max(1, Math.abs(beta![k])));
    beta = next;
    if (!moved) break;
  }
  const r = resid(beta);
  const mean = y.reduce((s, v) => s + v, 0) / y.length;
  const ssRes = r.reduce((s, e) => s + e * e, 0);
  const ssTot = y.reduce((s, v) => s + (v - mean) ** 2, 0);
  const robustScale = 1.4826 * median(r.map(Math.abs)) * Math.sqrt(clean.length / Math.max(1, clean.length - P));
  const downweighted = w.filter((x) => x < 0.999).length;
  return {
    version: MODEL_VERSION,
    kind: "OLS",
    coefficients: { intercept: beta[0], perTonne: beta[1], coldStart: beta[2], perHoldMinute: beta[3] },
    n: clean.length,
    r2: ssTot > 0 ? 1 - ssRes / ssTot : null,
    rmseKwh: robustScale > 0 ? robustScale : Math.sqrt(ssRes / Math.max(1, clean.length - P)),
    note: `Robust (Huber) fit on ${clean.length} heats; ${downweighted} unusual heat${downweighted === 1 ? "" : "s"} down-weighted.`,
  };
}

/** Expected kWh under good practice: the model with hold minutes set to zero. */
export function expectedGoodPracticeKwh(model: EnergyModel, f: Pick<HeatFeatures, "chargeTonnes" | "coldStart">): number {
  const c = model.coefficients;
  return c.intercept + c.perTonne * f.chargeTonnes + (f.coldStart ? c.coldStart : 0);
}

/** Full prediction including hold minutes. */
export function predictKwh(model: EnergyModel, f: HeatFeatures): number {
  return expectedGoodPracticeKwh(model, f) + model.coefficients.perHoldMinute * f.holdMinutes;
}
