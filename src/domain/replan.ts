/**
 * In-shift re-planning. The day-ahead plan assumes every heat goes as scheduled; in a real
 * shift a heat runs late, a mould is not ready, the furnace trips. Re-planning takes the
 * shift as it stands at minute `nowMin` and re-optimises only what is left:
 *
 *   • heats already poured are fixed: they are removed, their poured tonnes count towards
 *     their orders, and the last tap decides whether the next heat starts warm or cold;
 *   • the furnace is free from max(now, last tap + turnaround, busy-until, availability);
 *   • every other limit (moulds, holding limit, downtime, due times, site cap) is unchanged.
 *
 * The comparison "carry on" is what the shop floor would do without advice: start the next
 * heat as soon as the furnace is free and recharge straight after each tap.
 */
import { optimise, type OptimizerInput, type OptimizerResult } from "./optimizer";

export interface ShiftState {
  /** Local minute of the plan day at which to re-plan. */
  nowMin: number;
  /** Heats already poured, with their tap minute. */
  done: { key: string; tapMin: number }[];
  /** The furnace is busy (a heat melting, a repair) until this minute. Optional. */
  busyUntilMin?: number | null;
}

export interface ReplanResult {
  /** Optimiser result for the remaining heats only; null when every heat is already poured. */
  result: OptimizerResult | null;
  /** Minute from which the remaining heats can start. */
  freeFromMin: number;
  /** Heat keys treated as done. */
  doneKeys: string[];
  /** Tonnes still owed per order after the poured heats. */
  remainingTonnes: { orderId: string; code: string; tonnes: number }[];
  /** Plain-language notes about what was assumed. */
  notes: string[];
}

export function remainingInput(input: OptimizerInput, state: ShiftState): { input: OptimizerInput; freeFromMin: number; doneKeys: string[]; notes: string[] } {
  const notes: string[] = [];
  const known = new Set(input.heats.map((h) => h.key));
  const done = state.done.filter((d) => known.has(d.key));
  const doneKeys = new Set(done.map((d) => d.key));
  const lastTap = done.length ? Math.max(...done.map((d) => d.tapMin)) : null;

  const pouredByOrder = new Map<string, number>();
  for (const h of input.heats) if (doneKeys.has(h.key) && h.orderId) pouredByOrder.set(h.orderId, (pouredByOrder.get(h.orderId) ?? 0) + h.pouredKg / 1000);

  const freeFromMin = Math.max(
    input.furnace.availableFromMin,
    Math.ceil(state.nowMin),
    lastTap === null ? -Infinity : lastTap + input.process.turnaroundMinutes,
    state.busyUntilMin ?? -Infinity,
  );
  if (state.busyUntilMin != null && state.busyUntilMin >= freeFromMin) notes.push("The furnace is taken as busy until the time given.");
  if (lastTap !== null) notes.push(`${done.length} heat${done.length === 1 ? "" : "s"} already poured; the last tap decides whether the next heat starts warm.`);

  const keep = input.heats.map((h, i) => ({ h, i })).filter(({ h }) => !doneKeys.has(h.key));
  const next: OptimizerInput = {
    ...input,
    heats: keep.map(({ h }) => h),
    meltKwh: keep.map(({ i }) => input.meltKwh[i]),
    orders: input.orders.map((o) => ({ ...o, requiredTonnes: Math.max(0, o.requiredTonnes - (pouredByOrder.get(o.id) ?? 0)) })),
    furnace: { ...input.furnace, availableFromMin: freeFromMin, maxHeatsPerDay: Math.max(0, input.furnace.maxHeatsPerDay - done.length) },
    currentPracticeStartMin: freeFromMin,
    priorTapMin: lastTap,
  };
  return { input: next, freeFromMin, doneKeys: [...doneKeys], notes };
}

export function replan(input: OptimizerInput, state: ShiftState): ReplanResult {
  const r = remainingInput(input, state);
  const remainingTonnes = r.input.orders.map((o) => ({ orderId: o.id, code: o.code, tonnes: o.requiredTonnes }));
  if (r.input.heats.length === 0) {
    r.notes.push("Every planned heat is already poured; nothing is left to schedule.");
  }
  const result = r.input.heats.length === 0 ? null : optimise(r.input);
  return { result, freeFromMin: r.freeFromMin, doneKeys: r.doneKeys, remainingTonnes, notes: r.notes };
}
