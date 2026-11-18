import { describe, expect, it } from "vitest";
import { msedclHt1aFy27 } from "@/domain/tariff-presets";

describe("MSEDCL HT I(A) FY 2026-27 preset (MERC Case 75 of 2025, 25 Mar 2026)", () => {
  it("reproduces the order at unity power factor (₹/kVAh = ₹/kWh)", () => {
    const [aprSep, octMar] = msedclHt1aFy27(1);
    expect(aprSep.normalRate).toBe(9.25); // 8.44 + 0.81
    expect(octMar.normalRate).toBe(9.25);
    expect(aprSep.periods.find((p) => p.kind === "SOLAR")!.rate).toBe(7.98); // 9.25 − 15% × 8.44
    expect(octMar.periods.find((p) => p.kind === "SOLAR")!.rate).toBe(7.14); // 9.25 − 25% × 8.44
    expect(octMar.periods.find((p) => p.kind === "PEAK")!.rate).toBe(10.94); // 9.25 + 20% × 8.44
    expect(octMar.periods.find((p) => p.kind === "PEAK")).toMatchObject({ start: "17:00", end: "00:00" });
    expect(aprSep.effectiveFrom).toBe("2026-04-01T00:00");
    expect(octMar.effectiveFrom).toBe("2026-10-01T00:00");
    expect(octMar.demandRsPerKvaMonth).toBe(650);
  });

  it("converts kVAh rates to kWh at the site power factor", () => {
    const [, octMar] = msedclHt1aFy27(0.95);
    expect(octMar.normalRate).toBe(9.74); // 9.25 / 0.95
    expect(octMar.sourceNote).toMatch(/power factor 0.95/);
  });

  it("refuses an impossible power factor", () => {
    expect(() => msedclHt1aFy27(0)).toThrow();
    expect(() => msedclHt1aFy27(1.2)).toThrow();
  });
});

describe("preset fits the tariff editor's limits", () => {
  it("names, labels and source notes are within the validated lengths", () => {
    for (const p of msedclHt1aFy27(0.95)) {
      expect(p.name.length).toBeLessThanOrEqual(80);
      expect(p.sourceNote.length).toBeLessThanOrEqual(400);
      for (const w of p.periods) expect(w.label.length).toBeLessThanOrEqual(40);
    }
  });
});
