import { describe, expect, it } from "vitest";
import { detectDrift } from "@/domain/drift";
import { diffInterval, t90 } from "@/domain/stats";
import { fitModel, physicsPrior } from "@/domain/model";
import { addDays } from "@/domain/time";

const days = (vals: number[]) => vals.map((v, i) => ({ day: addDays("2026-09-01", i), residualPct: v, heats: 12 }));
const noise = (i: number) => Math.sin(i * 12.9898) * 0.6;

describe("CUSUM drift", () => {
  it("is stable on noise", () => {
    expect(detectDrift(days(Array.from({ length: 30 }, (_, i) => noise(i)))).status).toBe("STABLE");
  });
  it("detects a sustained 3% rise and dates it", () => {
    const r = detectDrift(days(Array.from({ length: 30 }, (_, i) => noise(i) + (i >= 15 ? 3 : 0))));
    expect(r.status).toBe("DRIFT_UP");
    expect(r.since! >= "2026-09-14" && r.since! <= "2026-09-17").toBe(true);
    expect(r.shiftPct!).toBeGreaterThan(2);
  });
  it("needs enough days", () => {
    expect(detectDrift(days([1, 2, 3])).status).toBe("INSUFFICIENT");
  });
});

describe("statistics", () => {
  it("t quantiles", () => {
    expect(t90(1e9)).toBeCloseTo(1.645, 2);
    expect(t90(10)).toBeCloseTo(1.812, 2);
    expect(t90(5)).toBeCloseTo(2.015, 1);
  });
  it("interval for a clear difference excludes zero; for noise it does not", () => {
    const base = [600, 610, 605, 595, 602, 608, 598];
    expect(diffInterval(base, [570])!.significant).toBe(true);
    expect(diffInterval(base, [603])!.significant).toBe(false);
    expect(diffInterval([600], [570])).toBeNull();
  });
});

describe("robust model", () => {
  it("is not pulled by a few anomalous heats", () => {
    const rows = Array.from({ length: 60 }, (_, i) => {
      const t = 0.4 + (i % 6) * 0.02;
      const cold = i % 7 === 0;
      const hold = i % 5;
      return { chargeTonnes: t, coldStart: cold, holdMinutes: hold, kwh: 20 + 600 * t + (cold ? 40 : 0) + 1 * hold + Math.sin(i) * 2 };
    });
    rows[3].kwh += 120;
    rows[17].kwh += 150;
    rows[42].kwh += 100;
    const m = fitModel(rows, physicsPrior(550, 35, 0.5, 5, 60));
    expect(m.kind).toBe("OLS");
    expect(m.coefficients.perTonne).toBeGreaterThan(560);
    expect(m.coefficients.perTonne).toBeLessThan(640);
    expect(m.coefficients.coldStart).toBeGreaterThan(30);
    expect(m.rmseKwh!).toBeLessThan(5);
    expect(m.note).toMatch(/down-weighted/);
  });
});
