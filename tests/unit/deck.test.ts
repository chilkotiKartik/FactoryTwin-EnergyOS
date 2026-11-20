import { describe, expect, it } from "vitest";
import { deckDayInput, deckPeriods } from "@/domain/deck";
import { optimise } from "@/domain/optimizer";

describe("deck day input (landing simulator)", () => {
  it("reproduces the deck result with default options", () => {
    const r = optimise(deckDayInput());
    expect(r.status).toBe("OPTIMAL");
    const cur = r.current.totals;
    const rec = r.recommended!.totals;
    expect(rec.kwh).toBeLessThan(cur.kwh);
    expect(rec.costPaise).toBeLessThan(cur.costPaise);
    expect(rec.holdMinutes).toBeLessThan(cur.holdMinutes);
  });

  it("applies discount and premium to the tariff windows", () => {
    const p = deckPeriods(0.3, 1.5);
    expect(p.find((x) => x.kind === "SOLAR")!.ratePaise).toBe(560);
    expect(p.find((x) => x.kind === "PEAK")!.ratePaise).toBe(1200);
    const input = deckDayInput({ solarDiscount: 0.3, peakMultiplier: 1.5 });
    expect(input.pricePaise[10 * 60]).toBe(560);
    expect(input.pricePaise[19 * 60]).toBe(1200);
    expect(input.pricePaise[7 * 60]).toBe(800);
  });

  it("delays mould sets from the chosen set onward", () => {
    const a = deckDayInput();
    const b = deckDayInput({ extraMouldDelayMin: 20 });
    expect(b.heats[5].mouldReadyMin).toBe(a.heats[5].mouldReadyMin);
    expect(b.heats[6].mouldReadyMin).toBe(a.heats[6].mouldReadyMin! + 20);
  });

  it("reports infeasibility and names a blocking limit when the cut-off is too early", () => {
    const r = optimise(deckDayInput({ deadlineMin: 15 * 60 }));
    expect(r.status).toBe("INFEASIBLE");
    expect(r.blocking.length).toBeGreaterThan(0);
  });
});
