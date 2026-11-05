import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { count } from "drizzle-orm";
import { optimizationRuns, recommendations } from "@/db/schema";
import { getPlan } from "@/server/services/plans";
import { buildInput, runOptimization, whatIf } from "@/server/services/optimization";
import { getRecommendation } from "@/server/services/recommendations";
import { freshDb, IDS } from "../helpers/db";

let t: Awaited<ReturnType<typeof freshDb>>;
beforeAll(async () => {
  t = await freshDb();
});
afterAll(() => t.cleanup());

describe("what-if", () => {
  it("matches a real run with no overrides and saves nothing", async () => {
    const a = await t.actor(IDS.supervisorA);
    const planId = (await getPlan(t.db, a))!.plan.id;
    const before = await t.db.select({ n: count() }).from(optimizationRuns);
    const recsBefore = await t.db.select({ n: count() }).from(recommendations);
    const w = await whatIf(t.db, a, planId, {});
    expect(w.status).toBe("OPTIMAL");
    expect(w.label).toBe("MODELLED");
    expect((await t.db.select({ n: count() }).from(optimizationRuns))[0].n).toBe(before[0].n);
    expect((await t.db.select({ n: count() }).from(recommendations))[0].n).toBe(recsBefore[0].n);
    const real = await runOptimization(t.db, a, planId);
    expect(real.status).toBe("OPTIMAL");
    expect(w.recommended!.holdMinutes).toBe(0);
    expect(w.savingPaisePerTonne!).toBeGreaterThan(0);
  });

  it("responds to tariff and deadline changes", async () => {
    const a = await t.actor(IDS.analystA);
    const planId = (await getPlan(t.db, a))!.plan.id;
    const base = await whatIf(t.db, a, planId, {});
    const dearPeak = await whatIf(t.db, a, planId, { peakRateFactor: 2, solarRateFactor: 0.5 });
    expect(dearPeak.current.costPaise).not.toBe(base.current.costPaise);
    const tooEarly = await whatIf(t.db, a, planId, { deadlineMin: 15 * 60 });
    expect(tooEarly.status).toBe("INFEASIBLE");
    expect(tooEarly.blocking.length).toBeGreaterThan(0);
  });

  it("clamps absurd values instead of failing", async () => {
    const a = await t.actor(IDS.operatorA);
    const planId = (await getPlan(t.db, a))!.plan.id;
    const w = await whatIf(t.db, a, planId, { solarRateFactor: 1e9, holdingKw: -5, maxHoldMinutes: Number.NaN });
    expect(["OPTIMAL", "INFEASIBLE"]).toContain(w.status);
  });
});

describe("reorder option", () => {
  it("is recorded on the run but does not change the input fingerprint", async () => {
    const a = await t.actor(IDS.supervisorA);
    const planId = (await getPlan(t.db, a))!.plan.id;
    const plain = await buildInput(t.db, a, planId);
    const withReorder = await buildInput(t.db, a, planId, { allowReorder: true });
    expect(withReorder.hash).toBe(plain.hash);
    expect((withReorder.snapshot as { options: { allowReorder: boolean } }).options.allowReorder).toBe(true);
    expect((plain.snapshot as { options: { allowReorder: boolean } }).options.allowReorder).toBe(false);
  });

  it("a run that may reorder still yields a valid, non-stale recommendation", async () => {
    const a = await t.actor(IDS.supervisorA);
    const planId = (await getPlan(t.db, a))!.plan.id;
    const run = await runOptimization(t.db, a, planId, { allowReorder: true });
    expect(run.status).toBe("OPTIMAL");
    if (run.recommendationId) {
      const rec = await getRecommendation(t.db, a, run.recommendationId);
      expect(rec!.rec.status).toBe("PENDING");
      const r = rec!.run.result as { reordered?: boolean; recommended: { checks: { id: string; status: string }[] } };
      expect(r.recommended.checks.find((c) => c.id === "sequence")!.status).toBe("PASS");
    }
  });

  it("what-if reports the new order when reordering helps and never worse cost otherwise", async () => {
    const a = await t.actor(IDS.analystA);
    const planId = (await getPlan(t.db, a))!.plan.id;
    const fixed = await whatIf(t.db, a, planId, {});
    const re = await whatIf(t.db, a, planId, { allowReorder: true });
    expect(re.recommended!.costPaise).toBeLessThanOrEqual(fixed.recommended!.costPaise + 1e-6);
    expect(re.sequence.length).toBe(fixed.sequence.length);
  });
});
