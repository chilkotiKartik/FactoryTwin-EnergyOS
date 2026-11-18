import { describe, expect, it } from "vitest";
import { optimise } from "@/domain/optimizer";
import { remainingInput, replan } from "@/domain/replan";
import { deckInput } from "../helpers/optimizer-input";

describe("in-shift re-planning", () => {
  const input = deckInput();
  const day = optimise(input).recommended!;

  it("with nothing done and now before the shift, matches the day-ahead plan", () => {
    const r = replan(input, { nowMin: 0, done: [] });
    expect(r.result!.recommended!.items.map((i) => i.startMin)).toEqual(day.items.map((i) => i.startMin));
    expect(r.result!.recommended!.totals.costPaise).toBeCloseTo(day.totals.costPaise, 6);
  });

  it("drops poured heats, credits their tonnes and never starts before now", () => {
    const first3 = day.items.slice(0, 3);
    const late = first3[2].tapMin + 45; // the shift is running 45 min behind
    const r = replan(input, { nowMin: late, done: first3.map((i) => ({ key: i.key, tapMin: i.tapMin })) });
    const rec = r.result!.recommended!;
    expect(r.result!.status).toBe("OPTIMAL");
    expect(rec.items).toHaveLength(input.heats.length - 3);
    expect(rec.items.some((i) => first3.some((d) => d.key === i.key))).toBe(false);
    expect(rec.items[0].startMin).toBeGreaterThanOrEqual(late);
    for (const it of rec.items) expect(it.tapMin).toBeGreaterThanOrEqual(it.mouldReadyMin ?? 0);
    const owed = r.remainingTonnes.reduce((s, o) => s + o.tonnes, 0);
    const total = input.orders.reduce((s, o) => s + o.requiredTonnes, 0);
    expect(owed).toBeCloseTo(total - first3.reduce((s, i) => s + i.pouredKg / 1000, 0), 6);
    // The plan for what is left still costs no more than carrying on as usual.
    expect(rec.totals.costPaise).toBeLessThanOrEqual(r.result!.current.totals.costPaise + 1e-6);
  });

  it("starts the next heat warm right after a recent tap, cold after a long gap", () => {
    const done = [{ key: input.heats[0].key, tapMin: 600 }];
    const warm = remainingInput(input, { nowMin: 600, done });
    expect(warm.input.priorTapMin).toBe(600);
    expect(warm.freeFromMin).toBe(600 + input.process.turnaroundMinutes);
    const r = replan(input, { nowMin: 600, done });
    const first = r.result!.current.items[0];
    expect(first.cold).toBe(first.startMin - 600 > input.process.coldGapMinutes);
    const coldLater = replan(input, { nowMin: 600 + input.process.coldGapMinutes + 60, done });
    expect(coldLater.result!.current.items[0].cold).toBe(true);
  });

  it("respects a furnace that is busy until a given time", () => {
    const r = replan(input, { nowMin: 480, done: [], busyUntilMin: 720 });
    expect(r.freeFromMin).toBe(720);
    if (r.result!.recommended) expect(r.result!.recommended.items[0].startMin).toBeGreaterThanOrEqual(720);
  });

  it("explains when the rest of the day can no longer fit", () => {
    const r = replan(input, { nowMin: input.deadlineMin - 30, done: [] });
    expect(r.result!.status).toBe("INFEASIBLE");
    expect(r.result!.blocking.length).toBeGreaterThan(0);
  });

  it("ignores unknown heat keys and reports nothing left when all are poured", () => {
    expect(remainingInput(input, { nowMin: 0, done: [{ key: "nope", tapMin: 500 }] }).doneKeys).toEqual([]);
    const all = replan(input, { nowMin: 1000, done: input.heats.map((h, i) => ({ key: h.key, tapMin: 500 + i })) });
    expect(all.result).toBeNull();
    expect(all.remainingTonnes.every((o) => o.tonnes === 0)).toBe(true);
  });
});
