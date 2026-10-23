import { describe, expect, it } from "vitest";
import { classifyReading, completeReading, completeness, findDuplicateTimestamps, findGaps, freshness, linkReadingsToHeats } from "@/domain/quality";
import { combineProvenance } from "@/domain/evidence";

const lim = { ratedKw: 550, intervalSeconds: 60 };
const M = 60_000;

describe("reading validation", () => {
  it("rejects negative, missing and impossible values", () => {
    expect(classifyReading({ ts: 0, powerKw: -1, energyKwh: null }, lim).quality).toBe("INVALID");
    expect(classifyReading({ ts: 0, powerKw: null, energyKwh: null }, lim).quality).toBe("INVALID");
    expect(classifyReading({ ts: 0, powerKw: 2000, energyKwh: null }, lim).quality).toBe("INVALID");
  });
  it("flags suspect values but keeps them", () => {
    expect(classifyReading({ ts: 0, powerKw: 700, energyKwh: null }, lim).quality).toBe("SUSPECT");
    expect(classifyReading({ ts: 0, powerKw: 600, energyKwh: 6.4 }, lim).quality).toBe("SUSPECT");
    expect(classifyReading({ ts: 0, powerKw: 480, energyKwh: 8 }, lim).quality).toBe("OK");
  });
  it("fills power from energy and vice versa", () => {
    expect(completeReading({ ts: 0, powerKw: 480, energyKwh: null }, 60)).toEqual({ powerKw: 480, energyKwh: 8 });
    expect(completeReading({ ts: 0, powerKw: null, energyKwh: 8 }, 60)).toEqual({ powerKw: 480, energyKwh: 8 });
  });
});

describe("gaps, duplicates, completeness, freshness", () => {
  it("finds a 25-minute gap", () => {
    const ts = Array.from({ length: 60 }, (_, i) => i * M).filter((t) => t < 15 * M || t >= 40 * M);
    const g = findGaps(ts, 0, 60 * M, 60);
    expect(g).toHaveLength(1);
    expect(g[0].missingIntervals).toBe(25);
    expect(completeness(ts.length, 0, 60 * M, 60)).toBeCloseTo(35 / 60);
  });
  it("finds a trailing gap", () => {
    expect(findGaps([0, M], 0, 5 * M, 60)[0].missingIntervals).toBe(3);
  });
  it("detects duplicate timestamps", () => {
    const d = findDuplicateTimestamps([{ ts: 1 }, { ts: 2 }, { ts: 1 }]);
    expect(d.size).toBe(1);
    expect(d.get(1)).toHaveLength(2);
  });
  it("calls data stale after five intervals", () => {
    expect(freshness(1000_000, 1000_000 + 5 * M, 60).status).toBe("FRESH");
    expect(freshness(1000_000, 1000_000 + 6 * M, 60).status).toBe("STALE");
    expect(freshness(null, 0, 60).status).toBe("NO_DATA");
  });
});

describe("linking energy to heats", () => {
  it("keeps load outside heats as unlinked, never assigning it to a heat", () => {
    const readings = Array.from({ length: 30 }, (_, i) => ({ ts: i * M, powerKw: i < 10 || i >= 20 ? 480 : 0, energyKwh: i < 10 || i >= 20 ? 8 : 0 }));
    const r = linkReadingsToHeats(readings, [{ id: "h1", start: 0, end: 10 * M }], 60);
    expect(r.linkedKwh).toBe(80);
    expect(r.unlinkedKwh).toBe(80);
    expect(r.unlinkedSpans).toHaveLength(1);
    expect(r.perHeatKwh.get("h1")).toBe(80);
  });
});

describe("evidence labels", () => {
  it("never upgrades synthetic or unverified data to MEASURED", () => {
    expect(combineProvenance(["MEASURED", "MEASURED"])).toBe("MEASURED");
    expect(combineProvenance(["MEASURED", "SIMULATED"])).toBe("SIMULATED");
    expect(combineProvenance(["MEASURED", "IMPORTED_UNVERIFIED"])).toBe("UNVERIFIED");
    expect(combineProvenance(["MANUAL"])).toBe("UNVERIFIED");
    expect(combineProvenance([])).toBe("NO_DATA");
  });
});
