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
 * Solved exactly by dynamic programming over (heat index, tap minute) on the start
 * grid, then refined at 1-minute resolution around that optimum and around current
 * practice. The result is optimal for this model on the grid and at least as good
 * as any schedule within one grid step of it, for this heat sequence. It is not
 * a claim of global optimality for the real plant.
 */

export const SOLVER_ID = "dp-grid";
export const SOLVER_VERSION = "1.1.0";

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

/** The connection the furnace shares with the rest of the plant. */
export interface SiteLoad {
  /** Hard limit on total real power (base load + furnace), kW, checked every minute. Null = no cap. */
  capKw: number | null;
  /** Other plant load for each local minute of the plan day, kW (length 1440). */
  baseLoadKw: ArrayLike<number>;
  /** Converts kW to kVA for demand reporting. */
  powerFactor: number;
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
  /**
   * Let the solver reorder heats, but only between slots of the same order (same grade).
   * Off by default: the sequence is then fixed as given.
   */
  allowReorder?: boolean;
  /** Shared-connection limits. When absent, the furnace is scheduled as if it were alone on the connection. */
  site?: SiteLoad;
  /**
   * Tap minute of the last heat already poured today (in-shift re-planning). The first heat
   * here is then warm if it starts within the cold gap of it. Null/absent = the day starts cold.
   */
  priorTapMin?: number | null;
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
    /**
     * Highest 15-minute block-average demand of base load plus furnace, kVA, using the site
     * power factor. Null when no site load is given. The usual billing-demand definition.
     */
    peak15Kva: number | null;
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
  /** Heat keys in the order of the recommended schedule (the given order when not reordered). */
  sequence: string[];
  /** True when the recommended sequence differs from the given one. */
  reordered: boolean;
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

const BLOCK = 15;

/** Range-maximum queries over a 1440-minute series in O(1) after O(n log n) set-up. */
function rangeMax(series: ArrayLike<number>): (a: number, b: number) => number {
  const n = 1440;
  const levels: Float64Array[] = [Float64Array.from({ length: n }, (_, i) => series[i] ?? 0)];
  for (let k = 1; 1 << k <= n; k++) {
    const prev = levels[k - 1];
    const cur = new Float64Array(n - (1 << k) + 1);
    for (let i = 0; i < cur.length; i++) cur[i] = Math.max(prev[i], prev[i + (1 << (k - 1))]);
    levels.push(cur);
  }
  return (a, b) => {
    const lo = Math.max(0, a);
    const hi = Math.min(n, b);
    if (hi <= lo) return -Infinity;
    const k = 31 - Math.clz32(hi - lo);
    return Math.max(levels[k][lo], levels[k][hi - (1 << k)]);
  };
}

/** Furnace power for each local minute of the plan day, kW. */
export function furnaceLoadProfile(input: OptimizerInput, items: Pick<ScheduledHeat, "startMin" | "meltEndMin" | "tapMin" | "meltKwh">[]): Float64Array {
  const p = new Float64Array(1440);
  for (const it of items) {
    const melt = it.meltEndMin - it.startMin;
    const meltKw = melt > 0 ? (it.meltKwh * 60) / melt : 0;
    for (let m = Math.max(0, it.startMin); m < Math.min(1440, it.meltEndMin); m++) p[m] += meltKw;
    for (let m = Math.max(0, it.meltEndMin); m < Math.min(1440, it.tapMin); m++) p[m] += input.process.holdingKw;
  }
  return p;
}

/** Highest 15-minute block-average of (base + furnace), kW. */
function peakBlockKw(base: ArrayLike<number>, furnace: Float64Array): number {
  let peak = 0;
  for (let b = 0; b < 1440; b += BLOCK) {
    let sum = 0;
    for (let m = b; m < b + BLOCK; m++) sum += (base[m] ?? 0) + furnace[m];
    peak = Math.max(peak, sum / BLOCK);
  }
  return peak;
}

/** Compute a schedule from given start times and check every hard constraint. */
export function evaluateSchedule(input: OptimizerInput, starts: number[]): ScheduleEvaluation {
  const pre = prefix(input.pricePaise);
  const items: ScheduledHeat[] = [];
  let prevTap: number | null = input.priorTapMin ?? null;
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

  let peak15Kva: number | null = null;
  if (input.site) {
    const furnace = furnaceLoadProfile(input, items);
    const base = input.site.baseLoadKw;
    peak15Kva = peakBlockKw(base, furnace) / Math.max(0.1, input.site.powerFactor);
    if (input.site.capKw !== null) {
      let worst = { m: -1, kw: 0 };
      for (let m = 0; m < 1440; m++) {
        const kw = (base[m] ?? 0) + furnace[m];
        if (kw > input.site.capKw + 1e-6 && kw > worst.kw) worst = { m, kw };
      }
      add(
        "site-cap",
        "Site demand cap",
        worst.m === -1,
        worst.m === -1
          ? `Base load plus furnace stays within ${input.site.capKw.toFixed(0)} kW (${(input.site.capKw / input.site.powerFactor).toFixed(0)} kVA) at every minute.`
          : `At ${fmt(worst.m)} the connection would carry ${worst.kw.toFixed(0)} kW, above the ${input.site.capKw.toFixed(0)} kW limit.`,
      );
    }
  }
  const totals = {
    peak15Kva,
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
  let prevTap: number | null = input.priorTapMin ?? null;
  for (let k = 0; k < input.heats.length; k++) {
    const S = k === 0 ? input.currentPracticeStartMin : prevTap! + input.process.turnaroundMinutes;
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
  let prevTap: number | null = input.priorTapMin ?? null;
  for (let k = 0; k < input.heats.length; k++) {
    const h = input.heats[k];
    let S = k === 0 ? input.furnace.availableFromMin : prevTap! + input.process.turnaroundMinutes;
    let why = k === 0 ? `availability starts ${fmt(input.furnace.availableFromMin)}` : "previous tap + turnaround";
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

/**
 * Exact dynamic programme over (heat index, tap minute). With `cand` null the start
 * times are the grid; otherwise each heat may start only at the listed minutes.
 */
interface DpSolution {
  starts: number[] | null;
  explored: number;
  cost: number;
  hold: number;
}

function solveDp(input: OptimizerInput, cand: number[][] | null): DpSolution {
  const pre = prefix(input.pricePaise);
  const g = input.gridMinutes;
  const n = input.heats.length;
  const H = 1441;
  const layers: (Cell | undefined)[][] = [];
  let explored = 0;
  const fromMin = Math.ceil(input.furnace.availableFromMin / g) * g;
  const toMin = Math.min(input.furnace.availableToMin, 1440);
  const fromAny = cand ? input.furnace.availableFromMin : fromMin;
  const capKw = input.site?.capKw ?? null;
  const baseMax = capKw !== null && input.site ? rangeMax(input.site.baseLoadKw) : null;

  for (let k = 0; k < n; k++) {
    const h = input.heats[k];
    const layer: (Cell | undefined)[] = new Array(H);
    const due = Math.min(orderDue(input, h.orderId), input.deadlineMin);
    const prevStates: { tap: number; cell: Cell | null }[] =
      k === 0
        ? [{ tap: input.priorTapMin ?? -1, cell: null }]
        : layers[k - 1].map((c, tap) => (c ? { tap, cell: c } : null)).filter((x): x is { tap: number; cell: Cell } => x !== null);
    for (const { tap: prevTap, cell } of prevStates) {
      const starts: Iterable<number> = cand
        ? cand[k].filter((S) => S >= (k === 0 ? fromAny : Math.max(fromAny, prevTap + input.process.turnaroundMinutes)))
        : (function* () {
            const earliest = k === 0 ? fromMin : Math.max(fromMin, Math.ceil((prevTap + input.process.turnaroundMinutes) / g) * g);
            for (let S = earliest; S <= toMin; S += g) yield S;
          })();
      for (const S of starts) {
        explored++;
        if (S > toMin) break;
        const cold = (k === 0 && input.priorTapMin == null) || S - prevTap > input.process.coldGapMinutes;
        const melt = meltMinutesFor(input, k, cold);
        const M = S + melt;
        const tap = Math.max(M, h.mouldReadyMin ?? -Infinity);
        if (tap > toMin) break; // later starts only finish later
        if (tap > due) break;
        const hold = tap - M;
        if (hold > input.process.maxHoldMinutes) continue;
        if (overlapsDowntime(input, S, tap)) continue;
        const meltKwh = cold ? input.meltKwh[k].cold : input.meltKwh[k].warm;
        if (baseMax && capKw !== null) {
          // Hard site cap: base load plus the furnace's power must fit under it in every minute.
          if (baseMax(S, M) + (meltKwh * 60) / melt > capKw + 1e-6) continue;
          if (hold > 0 && baseMax(M, tap) + input.process.holdingKw > capKw + 1e-6) continue;
        }
        const c = (priceSum(pre, S, M) * meltKwh) / melt + (priceSum(pre, M, tap) * input.process.holdingKw) / 60;
        const cc = { cost: (cell?.cost ?? 0) + c, hold: (cell?.hold ?? 0) + hold, prevTap, start: S };
        if (better(cc, layer[tap])) layer[tap] = cc;
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
  if (bestTap === -1) return { starts: null, explored, cost: Infinity, hold: Infinity };
  const { cost, hold } = last[bestTap]!;
  const starts = new Array<number>(n);
  let tap = bestTap;
  for (let k = n - 1; k >= 0; k--) {
    const c = layers[k][tap]!;
    starts[k] = c.start;
    tap = c.prevTap;
  }
  return { starts, explored, cost, hold };
}

/** Heats in a new order: slot `pos` takes original heat `perm[pos]`. */
function permute(input: OptimizerInput, perm: number[]): OptimizerInput {
  return { ...input, heats: perm.map((i) => input.heats[i]), meltKwh: perm.map((i) => input.meltKwh[i]) };
}

/** A reorder must save at least this much (paise) to be proposed; below it the given sequence stands. */
export const REORDER_MIN_GAIN_PAISE = 100;
const REORDER_MAX_EVALS = 120;
const REORDER_MAX_MS = 1500;

function betterSolution(a: DpSolution, b: DpSolution): boolean {
  if (!a.starts) return false;
  if (!b.starts) return true;
  return a.cost < b.cost - REORDER_MIN_GAIN_PAISE;
}

/**
 * Local search over heat order. A heat may only swap places with another heat of the
 * same order, so grade and order grouping are never mixed. Starts from "earliest mould
 * first" within each order, then hill-climbs on pairwise swaps, scoring every candidate
 * with the exact DP. Bounded in evaluations and time; returns null when nothing beats
 * the given sequence by at least REORDER_MIN_GAIN_PAISE.
 */
function searchSequence(input: OptimizerInput, base: DpSolution): { perm: number[]; solution: DpSolution; explored: number } | null {
  const n = input.heats.length;
  const groups = new Map<string, number[]>();
  input.heats.forEach((h, i) => {
    if (h.orderId) groups.set(h.orderId, [...(groups.get(h.orderId) ?? []), i]);
  });
  const multi = [...groups.values()].filter((g) => g.length > 1);
  if (multi.length === 0) return null;

  const t0 = performance.now();
  let evals = 0;
  let explored = 0;
  let bestPerm = Array.from({ length: n }, (_, i) => i);
  let best = base;
  const consider = (perm: number[]): boolean => {
    const sol = solveDp(permute(input, perm), null);
    evals++;
    explored += sol.explored;
    if (betterSolution(sol, best)) {
      best = sol;
      bestPerm = perm;
      return true;
    }
    return false;
  };

  // Seed: within each order, earliest mould-ready heat first.
  const seed = bestPerm.slice();
  for (const g of multi) {
    const sorted = [...g].sort((a, b) => (input.heats[a].mouldReadyMin ?? Infinity) - (input.heats[b].mouldReadyMin ?? Infinity) || a - b);
    g.forEach((pos, k) => (seed[pos] = sorted[k]));
  }
  consider(seed);

  for (let improved = true; improved && evals < REORDER_MAX_EVALS && performance.now() - t0 < REORDER_MAX_MS; ) {
    improved = false;
    for (const g of multi)
      for (let x = 0; x < g.length; x++)
        for (let y = x + 1; y < g.length; y++) {
          if (evals >= REORDER_MAX_EVALS || performance.now() - t0 >= REORDER_MAX_MS) break;
          const cand = bestPerm.slice();
          [cand[g[x]], cand[g[y]]] = [cand[g[y]], cand[g[x]]];
          if (consider(cand)) improved = true;
        }
  }
  return bestPerm.every((v, i) => v === i) ? null : { perm: bestPerm, solution: best, explored };
}

/** Independent check that only same-order heats changed places and nothing was dropped or duplicated. */
function sequenceCheck(original: OptimizerInput, items: { key: string }[]): ConstraintCheck {
  const keys = items.map((i) => i.key);
  const sameSet = keys.length === original.heats.length && new Set(keys).size === keys.length && original.heats.every((h) => keys.includes(h.key));
  const slotsOk = original.heats.every((h, pos) => {
    const moved = original.heats.find((x) => x.key === keys[pos]);
    return moved !== undefined && moved.orderId === h.orderId;
  });
  const moves = original.heats.filter((h, pos) => keys[pos] !== h.key).length;
  return {
    id: "sequence",
    label: "Heat sequence",
    status: sameSet && slotsOk ? "PASS" : "FAIL",
    detail: !(sameSet && slotsOk) ? "The recommended sequence adds, drops or moves heats between orders." : moves === 0 ? "Heat sequence unchanged." : `${moves} heats changed place, only within their own order. Confirm those mould sets can be poured in this order.`,
  };
}

export function optimise(input: OptimizerInput): OptimizerResult {
  const t0 = performance.now();
  const warnings: string[] = [];
  const current = evaluateSchedule(input, currentPracticeStarts(input));
  if (!current.feasible) warnings.push("The current-practice schedule breaks at least one hard limit; see its checks.");
  const optimalityNote =
    (input.allowReorder
      ? "Heat order may change only between heats of the same order; that search is bounded, so a reordered result is a good schedule rather than a proven optimum. For the sequence it ends with: "
      : "") +
    "Exact optimum of the stated model: fixed heat sequence, start times on a " +
    `${input.gridMinutes}-minute grid refined to 1-minute starts around the grid optimum, expected-energy model for melting, ${input.process.holdingKw} kW holding. Not a claim of global optimality for the real plant.`;

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
      sequence: input.heats.map((h) => h.key),
      reordered: false,
    };
  }

  let explored = 0;
  let coarse = solveDp(input, null);
  explored += coarse.explored;
  let work = input;
  if (input.allowReorder && input.heats.length > 1) {
    const found = searchSequence(input, coarse);
    if (found) {
      explored += found.explored;
      work = permute(input, found.perm);
      coarse = found.solution;
    }
  }
  const reordered = work !== input;
  let bestStarts = coarse.starts;
  if (coarse.starts && input.gridMinutes > 1) {
    // Refine: re-solve at 1-minute resolution around the grid optimum (and around
    // current practice), so a schedule that is not on the grid cannot beat the answer.
    const cur = currentPracticeStarts(work);
    const cand = coarse.starts.map((s, k) => {
      const set = new Set<number>();
      for (let d = -input.gridMinutes; d <= input.gridMinutes; d++) set.add(s + d);
      for (let d = -input.gridMinutes; d <= input.gridMinutes; d++) set.add(cur[k] + d);
      return [...set].filter((x) => x >= 0 && x <= 1440).sort((x, y) => x - y);
    });
    const fine = solveDp(work, cand);
    explored += fine.explored;
    if (fine.starts) {
      const a = evaluateSchedule(work, coarse.starts);
      const b = evaluateSchedule(work, fine.starts);
      if (b.feasible && (b.totals.costPaise < a.totals.costPaise - EPS || (Math.abs(b.totals.costPaise - a.totals.costPaise) <= EPS && b.totals.holdMinutes < a.totals.holdMinutes))) {
        bestStarts = fine.starts;
      }
    }
  }
  const bestTap = bestStarts ? 0 : -1;

  if (bestTap === -1) {
    const early = earliestSchedule(input);
    const blocking: BlockingConstraint[] = [];
    if (input.site && input.site.capKw !== null && solveDp({ ...input, site: { ...input.site, capKw: null } }, null).starts) {
      blocking.push({
        constraint: "Site demand cap",
        detail: `A schedule exists only if the ${input.site.capKw.toFixed(0)} kW cap is relaxed: base load plus a melting furnace exceeds it at the times the other limits allow. Reduce other load at those times, raise the cap, or move production.`,
      });
    }
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
        blocking.push({ constraint: "Combined limits", detail: `Earliest last tap ${fmt(lastItem.tapMin)}; no start-time combination on the ${input.gridMinutes}-minute grid satisfies every limit.` });
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
      sequence: input.heats.map((h) => h.key),
      reordered: false,
    };
  }

  const starts = bestStarts!;
  const recommended = evaluateSchedule(work, starts);
  recommended.checks.push(sequenceCheck(input, recommended.items));
  recommended.feasible = recommended.checks.every((c) => c.status === "PASS");
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
      sequence: input.heats.map((h) => h.key),
      reordered: false,
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
    sequence: recommended.items.map((i) => i.key),
    reordered,
  };
}
