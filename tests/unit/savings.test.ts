import { describe, expect, it } from "vitest";
import { estimateSavings, type SavingsInput } from "@/domain/savings";

const base: SavingsInput = {
  tonnesPerMonth: 150,
  secKwhPerT: 675,
  holdingPct: 3.4,
  holdingRecoverablePct: 100,
  shiftablePct: 0,
  normalRate: 8,
  solarDiscountPct: 20,
  emissionFactor: 0.727,
  capexRupees: 90_000,
  opexRupeesPerMonth: 5_000,
};

describe("estimateSavings", () => {
  it("is zero when there is no holding and nothing moves", () => {
    const r = estimateSavings({ ...base, holdingPct: 0, shiftablePct: 0 });
    expect(r.rupeesSavedPerMonth).toBe(0);
    expect(r.kwhSavedPerMonth).toBe(0);
    expect(r.paybackMonths).toBeNull();
    expect(r.secAfter).toBe(675);
  });

  it("values recovered holding at the normal rate and lowers SEC accordingly", () => {
    const r = estimateSavings(base);
    const kwh = 150 * 675;
    expect(r.kwhPerMonth).toBeCloseTo(kwh, 9);
    expect(r.kwhSavedPerMonth).toBeCloseTo(kwh * 0.034, 9);
    expect(r.rupeesFromHoldingPerMonth).toBeCloseTo(kwh * 0.034 * 8, 9);
    expect(r.secAfter!).toBeCloseTo(675 * (1 - 0.034), 9);
    expect(r.co2TonnesPerYear).toBeCloseTo((kwh * 0.034 * 12 * 0.727) / 1000, 9);
  });

  it("prices shifted kWh at the solar discount, on what remains after holding is removed", () => {
    const r = estimateSavings({ ...base, shiftablePct: 50 });
    const remaining = 150 * 675 * (1 - 0.034);
    expect(r.rupeesFromShiftPerMonth).toBeCloseTo(remaining * 0.5 * 8 * 0.2, 9);
  });

  it("gives a payback only when net savings are positive", () => {
    expect(estimateSavings({ ...base, opexRupeesPerMonth: 1e9 }).paybackMonths).toBeNull();
    const r = estimateSavings({ ...base, shiftablePct: 40 });
    expect(r.paybackMonths!).toBeCloseTo(90_000 / (r.rupeesSavedPerMonth - 5_000), 9);
  });

  it("clamps nonsense instead of producing NaN or negatives", () => {
    const r = estimateSavings({ ...base, tonnesPerMonth: Number.NaN, holdingPct: 400, solarDiscountPct: -5 });
    expect(Number.isFinite(r.rupeesSavedPerMonth)).toBe(true);
    expect(r.rupeesSavedPerMonth).toBeGreaterThanOrEqual(0);
    expect(r.secAfter).toBeNull();
  });
});
