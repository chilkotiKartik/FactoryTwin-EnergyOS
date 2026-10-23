import { describe, expect, it } from "vitest";
import { deckDefaultTariff, minuteRateTable, periodContains, rateAt, rateAtMinute, validatePeriods, versionAt, type TariffVersion } from "@/domain/tariff";
import { localToUtc } from "@/domain/time";

const TZ = "Asia/Kolkata";
const v1: TariffVersion = { ...deckDefaultTariff(localToUtc("2026-01-01", 0, TZ), TZ), id: "v1" };

describe("tariff windows", () => {
  it("applies boundaries as start-inclusive, end-exclusive", () => {
    expect(rateAtMinute(v1, 8 * 60 + 59).ratePaise).toBe(800);
    expect(rateAtMinute(v1, 9 * 60).ratePaise).toBe(640);
    expect(rateAtMinute(v1, 17 * 60 - 1).ratePaise).toBe(640);
    expect(rateAtMinute(v1, 17 * 60).ratePaise).toBe(800);
    expect(rateAtMinute(v1, 18 * 60).ratePaise).toBe(960);
    expect(rateAtMinute(v1, 22 * 60 - 1).ratePaise).toBe(960);
    expect(rateAtMinute(v1, 22 * 60).ratePaise).toBe(800);
  });
  it("supports windows that cross midnight and end at 24:00", () => {
    expect(periodContains({ startMin: 1320, endMin: 360 }, 1400)).toBe(true);
    expect(periodContains({ startMin: 1320, endMin: 360 }, 100)).toBe(true);
    expect(periodContains({ startMin: 1320, endMin: 360 }, 360)).toBe(false);
    expect(periodContains({ startMin: 1320, endMin: 1440 }, 1439)).toBe(true);
  });
  it("rejects overlapping windows and non-positive rates", () => {
    expect(validatePeriods(800, [
      { kind: "SOLAR", label: "a", startMin: 540, endMin: 1020, ratePaise: 640 },
      { kind: "PEAK", label: "b", startMin: 1000, endMin: 1100, ratePaise: 960 },
    ])[0].message).toMatch(/overlaps/);
    expect(validatePeriods(0, []).length).toBe(1);
    expect(validatePeriods(800, [{ kind: "PEAK", label: "x", startMin: 600, endMin: 600, ratePaise: 900 }]).length).toBe(1);
  });
  it("uses the version in force at each timestamp", () => {
    const v2: TariffVersion = { ...v1, id: "v2", version: 2, effectiveFrom: localToUtc("2026-10-21", 0, TZ), normalRatePaise: 900, periods: [] };
    const versions = [v1, v2];
    expect(rateAt(versions, localToUtc("2026-10-20", 600, TZ))!.ratePaise).toBe(640);
    expect(rateAt(versions, localToUtc("2026-10-21", 600, TZ))!.ratePaise).toBe(900);
    expect(versionAt(versions, localToUtc("2025-12-31", 0, TZ))).toBeNull();
  });
  it("builds a 1440-minute price table", () => {
    const t = minuteRateTable(v1);
    expect(t.length).toBe(1440);
    expect(t[600]).toBe(640);
  });
});
