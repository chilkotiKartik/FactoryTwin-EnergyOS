import { describe, expect, it } from "vitest";
import { evaluateSchedule, optimise } from "@/domain/optimizer";
import { deckInput } from "../helpers/optimizer-input";

describe("optimiser on the deck day", () => {
  const r = optimise(deckInput());
  it("finds an optimal, fully feasible schedule", () => {
    expect(r.status).toBe("OPTIMAL");
    expect(r.recommended!.feasible).toBe(true);
    expect(r.recommended!.checks.every((c) => c.status === "PASS")).toBe(true);
  });
  it("removes holding and starts at 08:50 like the deck", () => {
    expect(r.recommended!.totals.holdMinutes).toBe(0);
    expect(r.recommended!.totals.firstStartMin).toBe(8 * 60 + 50);
    expect(r.current.totals.holdMinutes).toBe(138);
  });
  it("lowers cost and energy while keeping production and sequence", () => {
    expect(r.recommended!.totals.costPaise).toBeLessThan(r.current.totals.costPaise);
    expect(r.recommended!.totals.kwh).toBeLessThan(r.current.totals.kwh);
    expect(r.recommended!.totals.tonnesPoured).toBe(r.current.totals.tonnesPoured);
    expect(r.recommended!.items.map((i) => i.label)).toEqual(r.current.items.map((i) => i.label));
  });
  it("never taps before the mould is ready", () => {
    for (const it of r.recommended!.items) expect(it.tapMin).toBeGreaterThanOrEqual(it.mouldReadyMin!);
  });
  it("is deterministic", () => {
    const again = optimise(deckInput());
    expect(again.recommended!.items.map((i) => i.startMin)).toEqual(r.recommended!.items.map((i) => i.startMin));
    expect(again.recommended!.totals.costPaise).toBe(r.recommended!.totals.costPaise);
  });
});

describe("hard constraints", () => {
  it("reports infeasible when the deadline is too early, and explains why", () => {
    const r = optimise(deckInput({ deadlineMin: 15 * 60 + 30 }));
    expect(r.status).toBe("INFEASIBLE");
    expect(r.recommended).toBeNull();
    expect(r.blocking.length).toBeGreaterThan(0);
    expect(r.blocking.map((b) => b.detail).join(" ")).toMatch(/15:30/);
  });
  it("respects planned downtime", () => {
    const r = optimise(deckInput({ furnace: { ...deckInput().furnace, downtime: [{ fromMin: 600, toMin: 660, reason: "Inspection" }] } }, Array(12).fill(null)));
    expect(r.status).toBe("OPTIMAL");
    for (const it of r.recommended!.items) expect(it.tapMin <= 600 || it.startMin >= 660).toBe(true);
  });
  it("flags a charge above furnace capacity", () => {
    const input = deckInput();
    input.heats[0] = { ...input.heats[0], chargeKg: 600, pouredKg: 600 };
    const r = optimise(input);
    expect(r.status).toBe("INFEASIBLE");
    expect(r.blocking.map((b) => b.constraint).join(" ")).toMatch(/capacity/i);
  });
  it("detects production shortfall against orders", () => {
    const input = deckInput();
    input.orders[0] = { ...input.orders[0], requiredTonnes: 10 };
    expect(optimise(input).status).toBe("INFEASIBLE");
  });
  it("independent evaluation catches an overlapping schedule", () => {
    const input = deckInput({}, [null, null]);
    const ev = evaluateSchedule(input, [600, 610]);
    expect(ev.feasible).toBe(false);
    expect(ev.checks.find((c) => c.id === "no-overlap")!.status).toBe("FAIL");
  });
});

describe("optimality against brute force", () => {
  it("matches exhaustive search on a small instance", () => {
    const input = deckInput({ furnace: { ...deckInput().furnace, availableFromMin: 480, availableToMin: 780 }, deadlineMin: 780 }, [560, 610, 700]);
    input.orders = [{ id: "o1", code: "PO", requiredTonnes: 1.5, dueMin: 780 }];
    input.heats = input.heats.map((h) => ({ ...h, orderId: "o1" }));
    const r = optimise(input);
    expect(r.status).toBe("OPTIMAL");
    let best: { cost: number; hold: number; last: number } | null = null;
    const grid: number[] = [];
    for (let m = 480; m <= 780; m += 5) grid.push(m);
    for (const a of grid)
      for (const b of grid) {
        if (b <= a) continue;
        for (const c of grid) {
          if (c <= b) continue;
          const ev = evaluateSchedule(input, [a, b, c]);
          if (!ev.feasible) continue;
          const t = ev.totals;
          const cand = { cost: t.costPaise, hold: t.holdMinutes, last: t.lastTapMin! };
          if (!best || cand.cost < best.cost - 1e-6 || (Math.abs(cand.cost - best.cost) <= 1e-6 && (cand.hold < best.hold || (cand.hold === best.hold && cand.last < best.last)))) best = cand;
        }
      }
    expect(best).not.toBeNull();
    expect(r.recommended!.totals.costPaise).toBeCloseTo(best!.cost, 4);
    expect(r.recommended!.totals.holdMinutes).toBe(best!.hold);
  });
});
