/**
 * Expected-energy model for a heat.
 *
 *   kWh ≈ b0 + b1·charge_t + b2·cold_start + b3·hold_min
 *
 * Fitted by ordinary least squares on past heats. "Expected under good practice"
 * is the prediction with hold_min set to zero, so the variance against it is the
 * avoidable part that the meter and heat log can explain. When there is not
 * enough history, a physics prior is used instead (rated kW × nominal melt time
 * scaled by charge), and the model says so.
 */

export const MODEL_VERSION = "heat-energy-ols-v1";

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

export function fitModel(rows: FitRow[], prior: EnergyModel): EnergyModel {
  const clean = rows.filter(
    (r) => Number.isFinite(r.kwh) && r.kwh > 0 && Number.isFinite(r.chargeTonnes) && r.chargeTonnes > 0 && Number.isFinite(r.holdMinutes) && r.holdMinutes >= 0,
  );
  if (clean.length < MIN_ROWS) return { ...prior, n: clean.length };
  const X = clean.map((r) => [1, r.chargeTonnes, r.coldStart ? 1 : 0, r.holdMinutes]);
  const y = clean.map((r) => r.kwh);
  const p = 4;
  const XtX = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const Xty = new Array<number>(p).fill(0);
  for (let i = 0; i < X.length; i++) {
    for (let a = 0; a < p; a++) {
      Xty[a] += X[i][a] * y[i];
      for (let b = 0; b < p; b++) XtX[a][b] += X[i][a] * X[i][b];
    }
  }
  const beta = solve(XtX, Xty);
  if (!beta || beta.some((v) => !Number.isFinite(v))) {
    return { ...prior, n: clean.length, note: "History does not vary enough to fit every term; using the physics prior." };
  }
  const mean = y.reduce((s, v) => s + v, 0) / y.length;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < X.length; i++) {
    const pred = X[i].reduce((s, v, k) => s + v * beta[k], 0);
    ssRes += (y[i] - pred) ** 2;
    ssTot += (y[i] - mean) ** 2;
  }
  return {
    version: MODEL_VERSION,
    kind: "OLS",
    coefficients: { intercept: beta[0], perTonne: beta[1], coldStart: beta[2], perHoldMinute: beta[3] },
    n: clean.length,
    r2: ssTot > 0 ? 1 - ssRes / ssTot : null,
    rmseKwh: Math.sqrt(ssRes / Math.max(1, clean.length - p)),
    note: `Fitted on ${clean.length} heats.`,
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
