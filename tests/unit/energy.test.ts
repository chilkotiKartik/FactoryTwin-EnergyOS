import { describe, expect, it } from "vitest";
import { avoidedEmissionsKg, costPerTonne, emissionsKg, energyCost, heatEnergyWithHoldingEstimate, holdingEnergyKwh, payback, savings, specificEnergy, variancePercent, varianceKwh } from "@/domain/energy";
import { deckDefaultTariff } from "@/domain/tariff";
import { localToUtc } from "@/domain/time";

const TZ = "Asia/Kolkata";
const tariff = [{ ...deckDefaultTariff(localToUtc("2026-01-01", 0, TZ), TZ), id: "t1" }];

describe("specific energy and variance", () => {
  it("computes SEC as kWh per poured tonne (deck baseline)", () => {
    expect(specificEnergy(4052, 6)).toBeCloseTo(675.33, 2);
  });
  it("returns null instead of dividing by zero or missing tonnes", () => {
    expect(specificEnergy(100, 0)).toBeNull();
    expect(specificEnergy(100, null)).toBeNull();
    expect(specificEnergy(null, 6)).toBeNull();
  });
  it("computes variance against expected (Heat 07: 366 vs 320)", () => {
    expect(varianceKwh(366, 320)).toBe(46);
    expect(variancePercent(366, 320)).toBeCloseTo(14.375, 3);
    expect(variancePercent(10, 0)).toBeNull();
  });
  it("cost per tonne in paise", () => {
    expect(costPerTonne(2779200, 6)).toBe(463200);
    expect(costPerTonne(1000, 0)).toBeNull();
  });
});

describe("holding energy", () => {
  it("holding kWh = kW × minutes / 60 (138 min at 60 kW = 138 kWh)", () => {
    expect(holdingEnergyKwh(60, 138)).toBe(138);
    expect(holdingEnergyKwh(60, -5)).toBeNull();
  });
  it("does not double count holding when the heat is metered", () => {
    expect(heatEnergyWithHoldingEstimate(366, 320, 60, 45)).toEqual({ kwh: 366, source: "METER" });
    expect(heatEnergyWithHoldingEstimate(null, 320, 60, 45)).toEqual({ kwh: 365, source: "ESTIMATE" });
    expect(heatEnergyWithHoldingEstimate(null, null, 60, 45)).toEqual({ kwh: null, source: "NONE" });
  });
});

describe("energy cost by tariff window", () => {
  const at = (hh: number, mm: number) => localToUtc("2026-10-20", hh * 60 + mm, TZ);
  it("prices each interval at the rate in force at its start", () => {
    const c = energyCost(
      [
        { ts: at(8, 59), energyKwh: 10 }, // normal ₹8.00
        { ts: at(9, 0), energyKwh: 10 }, // solar ₹6.40
        { ts: at(17, 59), energyKwh: 10 }, // normal (solar ends 17:00)
        { ts: at(18, 0), energyKwh: 10 }, // peak ₹9.60
        { ts: at(22, 0), energyKwh: 10 }, // normal again
      ],
      tariff,
    );
    expect(c.totalPaise).toBe(10 * 800 + 10 * 640 + 10 * 800 + 10 * 960 + 10 * 800);
    expect(c.byKind.SOLAR.kwh).toBe(10);
    expect(c.byKind.PEAK.kwh).toBe(10);
  });
  it("reports energy before any tariff as unpriced instead of guessing", () => {
    const c = energyCost([{ ts: localToUtc("2025-06-01", 600, TZ), energyKwh: 5 }], tariff);
    expect(c.unpricedKwh).toBe(5);
    expect(c.totalPaise).toBe(0);
  });
  it("skips negative or non-finite energy", () => {
    const c = energyCost([{ ts: at(10, 0), energyKwh: -3 }, { ts: at(10, 1), energyKwh: Number.NaN }], tariff);
    expect(c.pricedKwh).toBe(0);
  });
});

describe("emissions", () => {
  it("uses grid factor × kWh and credits only avoided kWh", () => {
    expect(emissionsKg(1000, 0.727)).toBeCloseTo(727);
    expect(avoidedEmissionsKg(138, 0.727)).toBeCloseTo(100.33, 2);
    expect(avoidedEmissionsKg(null, 0.727)).toBeNull();
    expect(emissionsKg(100, -1)).toBeNull();
  });
});

describe("savings and payback", () => {
  it("keeps energy, cost and per-tonne results separate", () => {
    const s = savings({ energyKwh: 4052, tonnesPoured: 6, costPaise: 2779200 }, { energyKwh: 3914, tonnesPoured: 6, costPaise: 2574000 });
    expect(s.energySavingKwh).toBe(138);
    expect(s.energySavingPercent).toBeCloseTo(3.406, 3);
    expect(s.secChangePercent).toBeCloseTo(-3.406, 3);
    expect(s.costPerTonneChangePercent).toBeCloseTo(-7.383, 3);
  });
  it("matches the deck payback (₹0.9 lakh, ₹5,000/month, ~₹6.16 lakh/yr gross)", () => {
    const p = payback({ dailyCostSavingInr: 2053, operatingDaysPerYear: 300, realisation: 1, capexInr: 90000, opexInrPerYear: 60000 });
    expect(p.status).toBe("PAYS_BACK");
    expect(p.annualGrossSavingInr).toBeCloseTo(615900);
    expect(p.paybackMonths!).toBeCloseTo(1.94, 1);
    expect(p.breakEvenRealisation!).toBeCloseTo(0.097, 3);
  });
  it("says when the investment is never recovered", () => {
    const p = payback({ dailyCostSavingInr: 100, operatingDaysPerYear: 300, realisation: 1, capexInr: 90000, opexInrPerYear: 60000 });
    expect(p.status).toBe("NOT_RECOVERED");
    expect(p.paybackMonths).toBeNull();
  });
  it("rejects invalid inputs", () => {
    expect(payback({ dailyCostSavingInr: 100, operatingDaysPerYear: 400, realisation: 1, capexInr: 1, opexInrPerYear: 0 }).status).toBe("INVALID_INPUT");
    expect(payback({ dailyCostSavingInr: 100, operatingDaysPerYear: 300, realisation: 1.5, capexInr: 1, opexInrPerYear: 0 }).status).toBe("INVALID_INPUT");
  });
});
