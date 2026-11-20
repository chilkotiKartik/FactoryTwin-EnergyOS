import { describe, expect, it } from "vitest";
import { windowStats } from "@/domain/window";

const bands = [
  { startMin: 0, endMin: 540, kind: "NORMAL", ratePaise: 800 },
  { startMin: 540, endMin: 1020, kind: "SOLAR", ratePaise: 640 },
  { startMin: 1020, endMin: 1440, kind: "NORMAL", ratePaise: 800 },
];

describe("window inspector statistics", () => {
  it("integrates 1-minute power into kWh and cost by tariff band", () => {
    // 600 kW for 60 minutes straddling 09:00 = 10 kWh per minute, 600 kWh in all.
    const points = Array.from({ length: 60 }, (_, i) => ({ m: 510 + i, kw: 600 }));
    const s = windowStats(points, bands, [], 510, 570);
    expect(s.kwh).toBeCloseTo(600);
    expect(s.kwhByKind.NORMAL).toBeCloseTo(300);
    expect(s.kwhByKind.SOLAR).toBeCloseTo(300);
    expect(s.costPaise).toBeCloseTo(300 * 800 + 300 * 640);
    expect(s.avgKw).toBeCloseTo(600);
    expect(s.peakKw).toBe(600);
  });

  it("treats missing readings as gaps, not zeros, and accepts a reversed selection", () => {
    const points = [
      { m: 600, kw: 120 },
      { m: 601, kw: null },
      { m: 602, kw: 240 },
    ];
    const s = windowStats(points, bands, [], 603, 600);
    expect(s.fromMin).toBe(600);
    expect(s.minutes).toBe(3);
    expect(s.coveredMinutes).toBe(2);
    expect(s.kwh).toBeCloseTo(6);
    expect(s.avgKw).toBeCloseTo(180);
  });

  it("counts holding minutes and heats that overlap the window", () => {
    const heats = [
      { startMin: 600, meltEndMin: 635, tapMin: 680 },
      { startMin: 700, meltEndMin: 735, tapMin: 735 },
      { startMin: 900, meltEndMin: null, tapMin: null },
    ];
    const s = windowStats([], bands, heats, 650, 720);
    expect(s.holdingMinutes).toBe(30);
    expect(s.heatsTouched).toBe(2);
    expect(s.kwh).toBe(0);
    expect(s.avgKw).toBeNull();
    expect(s.costPaise).toBe(0);
  });

  it("reports unknown cost rather than a wrong one when no tariff covers a measured minute", () => {
    const s = windowStats([{ m: 10, kw: 60 }], [], [], 0, 20);
    expect(s.kwh).toBeCloseTo(1);
    expect(s.costPaise).toBeNull();
  });
});
