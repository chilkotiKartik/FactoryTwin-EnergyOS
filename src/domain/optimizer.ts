/**
 * Day-ahead schedule optimiser for one induction furnace.
 *
 * Formulation (all times are local minutes from the plan day's midnight):
 *   decision     start time S_k of each heat k, on a fixed grid (default 5 min);
 *                heats run in the given sequence (mould set order).
 *   derived      cold_k   = k is first, or S_k − tap_{k−1} > coldGap
 *                melt_k   = nominal melt × charge/capacity (+ cold extra)
 *                M_k      = S_k + melt_k                     (metal ready)
 *                tap_k    = max(M_k, mouldReady_k)            (metal waits for its mould)
 *                hold_k   = tap_k − M_k
 *   objective    minimise Σ price(t)·kW(t) over melting and holding minutes,
 *                then total holding minutes, then the last tap time.
 *   hard limits  one heat at a time: S_{k+1} ≥ tap_k + turnaround
 *                availability window and downtime blocks (no melting or holding inside)
 *                hold_k ≤ maxHold (safety / lining limit)
 *                tap_k ≤ order due time and ≤ dispatch deadline
 *                charge ≤ furnace capacity; heats ≤ max heats per day
 *                poured tonnes per order ≥ required tonnes
 *
 * Solved exactly by dynamic programming over (heat index, tap minute). The result
 * is optimal for this model on this start grid with this heat sequence. It is not
 * a claim of global optimality for the real plant.
 */

export const SOLVER_ID = "dp-grid";
export const SOLVER_VERSION = "1.0.0";

export interface PlanHeat {
  key: string;
  label: string;
  orderId: string | null;
  chargeKg: number;
  /** Yield of poured metal per charged metal (ASSUMPTION; 1.0 = melt loss not modelled). */
  pouredKg: number;
  mouldSet: number | null;
  mouldReadyMin: number | null;
}

export interface PlanOrder {
  id: string;
  code: string;
  requiredTonnes: number;
  dueMin: number;
}

export interface Downtime {
  fromMin: number;
  toMin: number;
  reason: string;
}

export interface OptimizerInput {
  gridMinutes: number;
  heats: PlanHeat[];
  orders: PlanOrder[];
  furnace: {
    capacityKg: number;
    ratedKw: number;
    availableFromMin: number;
    availableToMin: number;
    maxHeatsPerDay: number;
    downtime: Downtime[];
  };
  process: {
    nominalMeltMinutes: number;
    coldExtraMinutes: number;
    coldGapMinutes: number;
    turnaroundMinutes: number;
    holdingKw: number;
    maxHoldMinutes: number;
  };
  /** Expected melting kWh per heat (good practice), warm and cold. Same length as heats. */
  meltKwh: { warm: number; cold: number }[];
  /** Price per local minute of the plan day, paise/kWh, length 1440. */
  pricePaise: ArrayLike<number>;
  deadlineMin: number;
  /** Start minute used by current practice (start at shift start, recharge right after tap). */
  currentPracticeStartMin: number;
}

export interface ScheduledHeat {
  key: string;
  label: string;
  orderId: string | null;
  mouldSet: number | null;
  mouldReadyMin: number | null;
  startMin: number;
  meltEndMin: number;
  tapMin: number;
  holdMin: number;
  cold: boolean;
  meltKwh: number;
  holdKwh: number;
  costPaise: number;
  pouredKg: number;
  chargeKg: number;
  /** Melting minutes falling in each tariff price band, for display. */
  meltMinutesByPrice: Record<string, number>;
}

export interface ConstraintCheck {
  id: string;
  label: string;
  status: "PASS" | "FAIL";
  detail: string;
}

export interface ScheduleEvaluation {
  items: ScheduledHeat[];
  totals: {
    kwh: number;
    meltKwh: number;
    holdKwh: number;
    costPaise: number;
    holdMinutes: number;
    tonnesPoured: number;
    firstStartMin: number | null;
    lastTapMin: number | null;
    meltMinutes: number;
    meltMinutesByPrice: Record<string, number>;
  };
  checks: ConstraintCheck[];
  feasible: boolean;
}

export interface BlockingConstraint {
  constraint: string;
  detail: string;
}

export type SolverStatus = "OPTIMAL" | "INFEASIBLE";

export interface OptimizerResult {
  status: SolverStatus;
  solver: string;
  solverVersion: string;
  runtimeMs: number;
  statesExplored: number;
  recommended: ScheduleEvaluation | null;
  current: ScheduleEvaluation;
  blocking: BlockingConstraint[];
  earliestPossible: ScheduleEvaluation | null;
  warnings: string[];
  optimalityNote: string;
}

const fmt = (m: number) => {
  const mm = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${String(Math.floor(mm / 60)).padStart(2, "0")}:${String(mm % 60).padStart(2, "0")}`;
};

export function meltMinutesFor(input: OptimizerInput, k: number, cold: boolean): number {
  const h = input.heats[k];
  const base = Math.ceil((input.process.nominalMeltMinutes * h.chargeKg) / input.furnace.capacityKg - 1e-9);
  return base + (cold ? input.process.coldExtraMinutes : 0);
}

function prefix(prices: ArrayLike<number>): Float64Array {
  const p = new Float64Array(1441);
  for (let i = 0; i < 1440; i++) p[i + 1] = p[i] + (prices[i] ?? 0);
  return p;
}

function priceSum(pre: Float64Array, a: number, b: number): number {
  const lo = Math.max(0, Math.min(1440, a));
  const hi = Math.max(0, Math.min(1440, b));
  return hi > lo ? pre[hi] - pre[lo] : 0;
}

function overlapsDowntime(input: OptimizerInput, a: number, b: number): Downtime | null {
  for (const d of input.furnace.downtime) if (a < d.toMin && d.fromMin < b) return d;
  return null;
}

function orderDue(input: OptimizerInput, orderId: string | null): number {
  if (!orderId) return Infinity;
  return input.orders.find((o) => o.id === orderId)?.dueMin ?? Infinity;
}

/** Compute a schedule from given start times and check every hard constraint. */
export function evaluateSchedule(input: OptimizerInput, starts: number[]): ScheduleEvaluation {
  const pre = prefix(input.pricePaise);
  const items: ScheduledHeat[] = [];
  let prevTap: number | null = null;
  const meltByPrice: Record<string, number> = {};
  for (let k = 0; k < input.heats.length; k++) {
    const h = input.heats[k];
    const S = starts[k];
    const cold = prevTap === null || S - prevTap > input.process.coldGapMinutes;
    const melt = meltMinutesFor(input, k, cold);
    const M = S + melt;
    const tap = Math.max(M, h.mouldReadyMin ?? -Infinity);
    const hold = tap - M;
    const meltKwh = cold ? input.meltKwh[k].cold : input.meltKwh[k].warm;
    const meltKw = (meltKwh * 60) / melt;
    const holdKwh = (input.process.holdingKw * hold) / 60;
    const cost = (priceSum(pre, S, M) * meltKw) / 60 + (priceSum(pre, M, tap) * input.process.holdingKw) / 60;
    const byPrice: Record<string, number> = {};
    for (let m = Math.max(0, S); m < Math.min(1440, M); m++) {
      const key = String(input.pricePaise[m]);
      byPrice[key] = (byPrice[key] ?? 0) + 1;
      meltByPrice[key] = (meltByPrice[key] ?? 0) + 1;
    }
    items.push({
      key: h.key,
      label: h.label,
      orderId: h.orderId,
      mouldSet: h.mouldSet,
      mouldReadyMin: h.mouldReadyMin,
      startMin: S,
      meltEndMin: M,
      tapMin: tap,
      holdMin: hold,
      cold,
      meltKwh,
      holdKwh,
      costPaise: cost,
      pouredKg: h.pouredKg,
      chargeKg: h.chargeKg,
      meltMinutesByPrice: byPrice,
    });
    prevTap = tap;
  }

  const checks: ConstraintCheck[] = [];
  const add = (id: string, label: string, ok: boolean, detail: string) => checks.push({ id, label, status: ok ? "PASS" : "FAIL", detail });

  // One heat at a time on the furnace
  const overlapBad = items.findIndex((it, i) => i > 0 && it.startMin < items[i - 1].tapMin + input.process.turnaroundMinutes);
  add(
    "no-overlap",
    "One heat at a time",
    overlapBad === -1,
    overlapBad === -1
      ? `Every heat starts at least ${input.process.turnaroundMinutes} min after the previous tap.`
      : `${items[overlapBad].label} starts ${fmt(items[overlapBad].startMin)}, before the previous tap + turnaround (${fmt(items[overlapBad - 1].tapMin + input.process.turnaroundMinutes)}).`,
  );

  // Mould before metal: tap never before mould ready (by construction) — check explicitly anyway
  const mouldBad = items.find((it) => it.mouldReadyMin !== null && it.tapMin < it.mouldReadyMin);
  add("mould-ready", "Mould ready before each tap", !mouldBad, mouldBad ? `${mouldBad.label} taps before its mould is ready.` : "Every tap is at or after its mould-ready time.");

  // Capacity
  const capBad = items.find((it) => it.chargeKg > input.furnace.capacityKg);
  add("capacity", "Furnace capacity", !capBad, capBad ? `${capBad.label} charges ${capBad.chargeKg} kg; capacity ${input.furnace.capacityKg} kg.` : `Every charge ≤ ${input.furnace.capacityKg} kg.`);

  add(
    "max-heats",
    "Heats per day",
    items.length <= input.furnace.maxHeatsPerDay,
    `${items.length} heats planned; limit ${input.furnace.maxHeatsPerDay}.`,
  );

  // Availability
  const availBad = items.find((it) => it.startMin < input.furnace.availableFromMin || it.tapMin > input.furnace.availableToMin);
  add(
    "availability",
    "Furnace availability",
    !availBad,
    availBad
      ? `${availBad.label} runs ${fmt(availBad.startMin)}–${fmt(availBad.tapMin)}, outside ${fmt(input.furnace.availableFromMin)}–${fmt(input.furnace.availableToMin)}.`
      : `All heats within ${fmt(input.furnace.availableFromMin)}–${fmt(input.furnace.availableToMin)}.`,
  );
  const downBad = items.map((it) => ({ it, d: overlapsDowntime(input, it.startMin, it.tapMin) })).find((x) => x.d);
  add(
    "downtime",
    "Planned downtime",
    !downBad,
    downBad
      ? `${downBad.it.label} overlaps downtime ${fmt(downBad.d!.fromMin)}–${fmt(downBad.d!.toMin)} (${downBad.d!.reason}).`
      : input.furnace.downtime.length
        ? "No heat overlaps planned downtime."
        : "No downtime planned.",
  );

  // Holding safety limit
  const holdBad = items.find((it) => it.holdMin > input.process.maxHoldMinutes);
  add(
    "max-hold",
    "Holding limit",
    !holdBad,
    holdBad ? `${holdBad.label} holds ${holdBad.holdMin} min; limit ${input.process.maxHoldMinutes} min.` : `No hold longer than ${input.process.maxHoldMinutes} min.`,
  );

  // Deadlines
  const lastTap = items.length ? items[items.length - 1].tapMin : null;
  const dlBad = items.find((it) => it.tapMin > input.deadlineMin);
  add("deadline", "Dispatch deadline", !dlBad, dlBad ? `${dlBad.label} taps ${fmt(dlBad.tapMin)}, after ${fmt(input.deadlineMin)}.` : `Last tap ${lastTap === null ? "—" : fmt(lastTap)}; deadline ${fmt(input.deadlineMin)}.`);
  const dueBad = items.find((it) => it.tapMin > orderDue(input, it.orderId));
  add(
    "order-due",
    "Order due times",
    !dueBad,
    dueBad
      ? `${dueBad.label} (order ${input.orders.find((o) => o.id === dueBad.orderId)?.code}) taps ${fmt(dueBad.tapMin)}, after due ${fmt(orderDue(input, dueBad.orderId))}.`
      : "Every heat taps before its order is due.",
  );

  // Production preserved
  const shortfalls = input.orders
    .map((o) => ({ o, t: items.filter((it) => it.orderId === o.id).reduce((s, it) => s + it.pouredKg, 0) / 1000 }))
    .filter((x) => x.t + 1e-9 < x.o.requiredTonnes);
  const tonnes = items.reduce((s, it) => s + it.pouredKg, 0) / 1000;
  add(
    "production",
    "Required output",
    shortfalls.length === 0,
    shortfalls.length
      ? shortfalls.map((x) => `Order ${x.o.code}: ${x.t.toFixed(2)} t planned, ${x.o.requiredTonnes.toFixed(2)} t required.`).join(" ")
      : `${tonnes.toFixed(2)} t poured covers ${input.orders.reduce((s, o) => s + o.requiredTonnes, 0).toFixed(2)} t ordered.`,
  );

  const totals = {
    kwh: items.reduce((s, it) => s + it.meltKwh + it.holdKwh, 0),
    meltKwh: items.reduce((s, it) => s + it.meltKwh, 0),
    holdKwh: items.reduce((s, it) => s + it.holdKwh, 0),
    costPaise: items.reduce((s, it) => s + it.costPaise, 0),
    holdMinutes: items.reduce((s, it) => s + it.holdMin, 0),
    tonnesPoured: tonnes,
    firstStartMin: items.length ? items[0].startMin : null,
    lastTapMin: lastTap,
    meltMinutes: items.reduce((s, it) => s + (it.meltEndMin - it.startMin), 0),
    meltMinutesByPrice: meltByPrice,
  };
  return { items, totals, checks, feasible: checks.every((c) => c.status === "PASS") };
}

/** Current practice: start at the shift start and recharge immediately after each tap. */
export function currentPracticeStarts(input: OptimizerInput): number[] {
  const starts: number[] = [];
  let prevTap: number | null = null;
  for (let k = 0; k < input.heats.length; k++) {
    const S = prevTap === null ? input.currentPracticeStartMin : prevTap + input.process.turnaroundMinutes;
    const cold = prevTap === null || S - prevTap > input.process.coldGapMinutes;
    const M = S + meltMinutesFor(input, k, cold);
    prevTap = Math.max(M, input.heats[k].mouldReadyMin ?? -Infinity);
    starts.push(S);
  }
  return starts;
}

interface Cell {
  cost: number;
  hold: number;
  prevTap: number; // -1 for first heat
  start: number;
}

const EPS = 1e-6;
function better(a: { cost: number; hold: number }, b: { cost: number; hold: number } | undefined): boolean {
  if (!b) return true;
  if (a.cost < b.cost - EPS) return true;
  if (a.cost > b.cost + EPS) return false;
  return a.hold < b.hold;
}

function preChecks(input: OptimizerInput): BlockingConstraint[] {
  const out: BlockingConstraint[] = [];
  if (input.heats.length === 0) out.push({ constraint: "No heats", detail: "The plan has no heats to schedule." });
  if (input.heats.length > input.furnace.maxHeatsPerDay)
    out.push({ constraint: "Heats per day", detail: `${input.heats.length} heats needed; the furnace limit is ${input.furnace.maxHeatsPerDay} per day.` });
  for (const h of input.heats)
    if (h.chargeKg > input.furnace.capacityKg)
      out.push({ constraint: "Furnace capacity", detail: `${h.label} charges ${h.chargeKg} kg; furnace capacity is ${input.furnace.capacityKg} kg.` });
  for (const o of input.orders) {
    const t = input.heats.filter((h) => h.orderId === o.id).reduce((s, h) => s + h.pouredKg, 0) / 1000;
    if (t + 1e-9 < o.requiredTonnes)
      out.push({ constraint: "Required output", detail: `Order ${o.code} needs ${o.requiredTonnes.toFixed(2)} t; its heats pour ${t.toFixed(2)} t.` });
  }
  if (input.furnace.availableToMin <= input.furnace.availableFromMin)
    out.push({ constraint: "Furnace availability", detail: "The availability window is empty." });
  return out;
}

/**
 * Earliest-possible schedule ignoring deadlines and order due times but keeping
 * every physical limit. Used to explain infeasibility: if even this schedule is
 * late, no schedule meets the deadline. Records which constraint set each time.
 */
export function earliestSchedule(input: OptimizerInput): { starts: number[] | null; reasons: string[]; failure: string | null } {
  const g = input.gridMinutes;
  const starts: number[] = [];
  const reasons: string[] = [];
  let prevTap: number | null = null;
  for (let k = 0; k < input.heats.length; k++) {
    const h = input.heats[k];
    let S = prevTap === null ? input.furnace.availableFromMin : prevTap + input.process.turnaroundMinutes;
    let why = prevTap === null ? `availability starts ${fmt(input.furnace.availableFromMin)}` : "previous tap + turnaround";
    S = Math.ceil(S / g) * g;
    let placed = false;
    for (let guard = 0; guard < 2000 && S <= input.furnace.availableToMin; guard++) {
      const cold = prevTap === null || S - prevTap > input.process.coldGapMinutes;
      const M = S + meltMinutesFor(input, k, cold);
      const tap = Math.max(M, h.mouldReadyMin ?? -Infinity);
      if (tap - M > input.process.maxHoldMinutes) {
        S = Math.ceil((h.mouldReadyMin! - input.process.maxHoldMinutes - meltMinutesFor(input, k, cold)) / g) * g;
        why = `mould set ${h.mouldSet} ready ${fmt(h.mouldReadyMin!)} and holding limit ${input.process.maxHoldMinutes} min`;
        continue;
      }
      const d = overlapsDowntime(input, S, tap);
      if (d) {
        S = Math.ceil(d.toMin / g) * g;
        why = `downtime ${fmt(d.fromMin)}–${fmt(d.toMin)} (${d.reason})`;
        continue;
      }
      if (tap > input.furnace.availableToMin) break;
      if (tap > M) why = `mould set ${h.mouldSet} ready ${fmt(h.mouldReadyMin!)}`;
      starts.push(S);
      reasons.push(why);
      prevTap = tap;
      placed = true;
      break;
    }
    if (!placed) {
      return {
        starts: null,
        reasons,
        failure: `${h.label} cannot be completed before the furnace becomes unavailable at ${fmt(input.furnace.availableToMin)} (${why}).`,
      };
    }
  }
  return { starts, reasons, failure: null };
}

export function optimise(input: OptimizerInput): OptimizerResult {
  const t0 = performance.now();
  const warnings: string[] = [];
  const current = evaluateSchedule(input, currentPracticeStarts(input));
  if (!current.feasible) warnings.push("The current-practice schedule breaks at least one hard limit; see its checks.");
  const optimalityNote =
    "Exact optimum of the stated model: fixed heat sequence, start times on a " +
    `${input.gridMinutes}-minute grid, expected-energy model for melting, ${input.process.holdingKw} kW holding. Not a claim of global optimality for the real plant.`;

  const blockingPre = preChecks(input);
  if (blockingPre.length) {
    return {
      status: "INFEASIBLE",
      solver: SOLVER_ID,
      solverVersion: SOLVER_VERSION,
      runtimeMs: performance.now() - t0,
      statesExplored: 0,
      recommended: null,
      current,
      blocking: blockingPre,
      earliestPossible: null,
      warnings,
      optimalityNote,
    };
  }

  const pre = prefix(input.pricePaise);
  const g = input.gridMinutes;
  const n = input.heats.length;
  const H = 1441;
  const layers: (Cell | undefined)[][] = [];
  let explored = 0;
  const fromMin = Math.ceil(input.furnace.availableFromMin / g) * g;
  const toMin = Math.min(input.furnace.availableToMin, 1440);

  for (let k = 0; k < n; k++) {
    const h = input.heats[k];
    const layer: (Cell | undefined)[] = new Array(H);
    const due = Math.min(orderDue(input, h.orderId), input.deadlineMin);
    const prevStates: { tap: number; cell: Cell | null }[] =
      k === 0
        ? [{ tap: -1, cell: null }]
        : layers[k - 1].map((c, tap) => (c ? { tap, cell: c } : null)).filter((x): x is { tap: number; cell: Cell } => x !== null);
    for (const { tap: prevTap, cell } of prevStates) {
      const earliest = k === 0 ? fromMin : Math.max(fromMin, Math.ceil((prevTap + input.process.turnaroundMinutes) / g) * g);
      for (let S = earliest; S <= toMin; S += g) {
        explored++;
        const cold = k === 0 || S - prevTap > input.process.coldGapMinutes;
        const melt = meltMinutesFor(input, k, cold);
        const M = S + melt;
        const tap = Math.max(M, h.mouldReadyMin ?? -Infinity);
        if (tap > toMin) break; // later starts only finish later
        if (tap > due) break;
        const hold = tap - M;
        if (hold > input.process.maxHoldMinutes) continue;
        if (overlapsDowntime(input, S, tap)) continue;
        const meltKwh = cold ? input.meltKwh[k].cold : input.meltKwh[k].warm;
        const c = (priceSum(pre, S, M) * meltKwh) / melt + (priceSum(pre, M, tap) * input.process.holdingKw) / 60;
        const cand = { cost: (cell?.cost ?? 0) + c, hold: (cell?.hold ?? 0) + hold, prevTap, start: S };
        if (better(cand, layer[tap])) layer[tap] = cand;
      }
    }
    layers.push(layer);
  }

  const last = layers[n - 1];
  let bestTap = -1;
  for (let tap = 0; tap < H; tap++) {
    const c = last[tap];
    if (c && (bestTap === -1 || better(c, last[bestTap]))) bestTap = tap;
  }

  if (bestTap === -1) {
    const early = earliestSchedule(input);
    const blocking: BlockingConstraint[] = [];
    let earliestPossible: ScheduleEvaluation | null = null;
    if (!early.starts) {
      blocking.push({ constraint: "Furnace availability", detail: early.failure ?? "Heats do not fit in the availability window." });
    } else {
      earliestPossible = evaluateSchedule(input, early.starts);
      const lastItem = earliestPossible.items[earliestPossible.items.length - 1];
      for (const it of earliestPossible.items) {
        const d = Math.min(orderDue(input, it.orderId), input.deadlineMin);
        if (it.tapMin > d) {
          const k = earliestPossible.items.indexOf(it);
          const isOrder = orderDue(input, it.orderId) <= input.deadlineMin;
          blocking.push({
            constraint: isOrder ? "Order due time" : "Dispatch deadline",
            detail: `${it.label} cannot tap before ${fmt(it.tapMin)} but must tap by ${fmt(d)}. Earliest start ${fmt(it.startMin)} is set by ${early.reasons[k]}.`,
          });
          break;
        }
      }
      const failIdx = earliestPossible.items.findIndex((it) => it.tapMin > Math.min(orderDue(input, it.orderId), input.deadlineMin));
      const upTo = early.reasons.slice(0, failIdx === -1 ? early.reasons.length : failIdx + 1);
      for (const r of new Set(upTo.filter((r) => r.startsWith("downtime")))) {
        blocking.push({ constraint: "Planned downtime", detail: `No melting or holding allowed during ${r.replace("downtime ", "")}; later heats shift accordingly.` });
      }
      const mouldBound = earliestPossible.items.slice(0, upTo.length).filter((it, i) => upTo[i].startsWith("mould") || it.holdMin > 0);
      if (mouldBound.length) {
        blocking.push({
          constraint: "Mould readiness",
          detail: `Metal cannot be tapped before its mould: ${mouldBound.length} of the first ${upTo.length} heats wait for moulds (sets ${mouldBound.map((it) => it.mouldSet).join(", ")}).`,
        });
      }
      blocking.push({
        constraint: "Total melt time",
        detail: `Each heat needs about ${input.process.nominalMeltMinutes} min melting plus ${input.process.turnaroundMinutes} min turnaround; ${input.heats.length} heats cannot fit before the cut-off with these limits.`,
      });
      if (blocking.length === 0)
        blocking.push({ constraint: "Combined limits", detail: `Earliest last tap ${fmt(lastItem.tapMin)}; no start-time combination on the ${g}-minute grid satisfies every limit.` });
    }
    return {
      status: "INFEASIBLE",
      solver: SOLVER_ID,
      solverVersion: SOLVER_VERSION,
      runtimeMs: performance.now() - t0,
      statesExplored: explored,
      recommended: null,
      current,
      blocking,
      earliestPossible,
      warnings,
      optimalityNote,
    };
  }

  // Back-track
  const starts = new Array<number>(n);
  let tap = bestTap;
  for (let k = n - 1; k >= 0; k--) {
    const c = layers[k][tap]!;
    starts[k] = c.start;
    tap = c.prevTap;
  }
  const recommended = evaluateSchedule(input, starts);
  if (!recommended.feasible) {
    // Should not happen: the evaluator re-checks the solver independently.
    warnings.push("Independent check found a violated limit in the solver output; recommendation withheld.");
    return {
      status: "INFEASIBLE",
      solver: SOLVER_ID,
      solverVersion: SOLVER_VERSION,
      runtimeMs: performance.now() - t0,
      statesExplored: explored,
      recommended: null,
      current,
      blocking: recommended.checks.filter((c) => c.status === "FAIL").map((c) => ({ constraint: c.label, detail: c.detail })),
      earliestPossible: null,
      warnings,
      optimalityNote,
    };
  }
  if (recommended.totals.costPaise > current.totals.costPaise + EPS && current.feasible) {
    warnings.push("Current practice uses start times off the solver grid and is cheaper than the grid optimum; consider a finer grid.");
  }
  return {
    status: "OPTIMAL",
    solver: SOLVER_ID,
    solverVersion: SOLVER_VERSION,
    runtimeMs: performance.now() - t0,
    statesExplored: explored,
    recommended,
    current,
    blocking: [],
    earliestPossible: null,
    warnings,
    optimalityNote,
  };
}
