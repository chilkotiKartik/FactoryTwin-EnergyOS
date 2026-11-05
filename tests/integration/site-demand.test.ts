import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { recommendations } from "@/db/schema";
import { getPlan } from "@/server/services/plans";
import { buildInput, runOptimization, whatIf } from "@/server/services/optimization";
import { getSettings, updateSettings } from "@/server/services/settings";
import { freshDb, IDS } from "../helpers/db";

let t: Awaited<ReturnType<typeof freshDb>>;
beforeAll(async () => {
  t = await freshDb();
});
afterAll(() => t.cleanup());

async function configure(extra: Record<string, unknown>) {
  const owner = await t.actor(IDS.ownerA);
  const { factory: f, furnace } = await getSettings(t.db, owner);
  await updateSettings(t.db, owner, {
    holdingKw: f.holdingKw,
    emissionFactor: f.emissionFactor,
    emissionFactorSource: f.emissionFactorSource,
    turnaroundMinutes: f.turnaroundMinutes,
    coldGapMinutes: f.coldGapMinutes,
    coldExtraMinutes: f.coldExtraMinutes,
    maxHoldMinutes: f.maxHoldMinutes,
    minCompletenessPct: f.minCompleteness * 100,
    gridMinutes: f.gridMinutes,
    capacityKg: furnace.capacityKg,
    ratedKw: furnace.ratedKw,
    nominalMeltMinutes: furnace.nominalMeltMinutes,
    availableFromMin: furnace.availableFromMin,
    availableToMin: furnace.availableToMin,
    maxHeatsPerDay: furnace.maxHeatsPerDay,
    ...extra,
  });
}

describe("site demand settings", () => {
  it("without site settings nothing changes: no site input and no peak figure", async () => {
    const a = await t.actor(IDS.supervisorA);
    const planId = (await getPlan(t.db, a))!.plan.id;
    const built = await buildInput(t.db, a, planId);
    expect(built.input.site).toBeUndefined();
    const w = await whatIf(t.db, a, planId, {});
    expect(w.recommended!.peak15Kva).toBeNull();
  });

  it("validates the new settings", async () => {
    await expect(configure({ powerFactor: 1.5 })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(configure({ siteCapKva: -5 })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(configure({ baseLoadDayKw: -1 })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("a cap with headroom is respected and the peak and bill effect are reported", async () => {
    await configure({ siteCapKva: 700, powerFactor: 0.95, baseLoadDayKw: 100, baseLoadNightKw: 50, demandRateRupeesPerKvaMonth: 400 });
    const sup = await t.actor(IDS.supervisorA);
    const planId = (await getPlan(t.db, sup))!.plan.id;
    const built = await buildInput(t.db, sup, planId);
    expect(built.input.site!.capKw).toBeCloseTo(665, 6);
    expect(built.input.site!.baseLoadKw[12 * 60]).toBe(100);
    expect(built.input.site!.baseLoadKw[2 * 60]).toBe(50);

    const run = await runOptimization(t.db, sup, planId);
    expect(run.status).toBe("OPTIMAL");
    expect(run.recommendationId).toBeTruthy();
    const rec = (await t.db.query.recommendations.findFirst({ where: eq(recommendations.id, run.recommendationId!) }))!;
    const p = rec.predicted as { peak: { currentKva: number; recommendedKva: number; monthlyChargeDeltaPaise: number } };
    expect(p.peak.recommendedKva).toBeLessThanOrEqual(700 + 1e-6);
    expect(p.peak.currentKva).toBeGreaterThan(0);
    expect(Number.isFinite(p.peak.monthlyChargeDeltaPaise)).toBe(true);
  });

  it("when other load leaves no headroom the run is infeasible and says why", async () => {
    await configure({ siteCapKva: 700, powerFactor: 0.95, baseLoadDayKw: 250, baseLoadNightKw: 50 });
    const sup = await t.actor(IDS.supervisorA);
    const planId = (await getPlan(t.db, sup))!.plan.id;
    const run = await runOptimization(t.db, sup, planId);
    expect(run.status).toBe("INFEASIBLE");
    expect(run.recommendationId).toBeNull();
    expect(run.message).toMatch(/Site demand cap|relaxed/i);
    // Restore for the following test.
    await configure({ siteCapKva: null, baseLoadDayKw: 0, baseLoadNightKw: 0, demandRateRupeesPerKvaMonth: null });
  });

  it("what-if can lift or tighten the cap without saving anything", async () => {
    const a = await t.actor(IDS.analystA);
    const planId = (await getPlan(t.db, a))!.plan.id;
    const none = await whatIf(t.db, a, planId, { siteCapKva: null });
    const tight = await whatIf(t.db, a, planId, { siteCapKva: 400 });
    expect(none.status).toBe("OPTIMAL");
    expect(tight.status).toBe("INFEASIBLE");
    expect(tight.blocking.join(" ")).toMatch(/Site demand cap/);
  });
});
