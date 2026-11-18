import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { count } from "drizzle-orm";
import { heats, optimizationRuns } from "@/db/schema";
import { localToUtc } from "@/domain/time";
import { getPlan } from "@/server/services/plans";
import { replanShift } from "@/server/services/optimization";
import { freshDb, IDS } from "../helpers/db";

let t: Awaited<ReturnType<typeof freshDb>>;
beforeAll(async () => {
  t = await freshDb();
});
afterAll(() => t.cleanup());

describe("in-shift re-planning service", () => {
  it("re-plans from a given time, saves nothing, and takes poured heats from the heat log", async () => {
    const a = await t.actor(IDS.supervisorA);
    const detail = (await getPlan(t.db, a))!;
    const before = await t.db.select({ n: count() }).from(optimizationRuns);

    const fresh = await replanShift(t.db, a, detail.plan.id, { nowMin: 0 });
    expect(fresh.status).toBe("OPTIMAL");
    expect(fresh.items).toHaveLength(detail.heats.length);

    // Two heats are recorded as tapped in the heat log for the plan day.
    const [h1, h2] = detail.heats;
    const furnaceId = (await t.db.query.furnaces.findFirst())!.id;
    const tz = a.factory.timeZone;
    const date = detail.plan.planDate;
    for (const [i, h] of [h1, h2].entries()) {
      await t.db.insert(heats).values({
        id: `heat_rp_${i}`,
        factoryId: a.factory.id,
        furnaceId,
        dayDate: date,
        heatNo: h.heatNo,
        chargeKg: h.chargeKg,
        pouredKg: h.pouredKg,
        startAt: localToUtc(date, 600 + i * 90, tz),
        tapAt: localToUtc(date, 660 + i * 90, tz),
        provenance: "MANUAL",
        updatedAt: Date.now(),
      });
    }
    const later = await replanShift(t.db, a, detail.plan.id, { nowMin: 800 });
    expect(later.heats.filter((h) => h.done).map((h) => h.label)).toEqual([h1.heatNo, h2.heatNo]);
    expect(later.heats.find((h) => h.label === h2.heatNo)!.recordedTapMin).toBe(750);
    expect(later.freeFromMin).toBeGreaterThanOrEqual(800);
    if (later.status === "OPTIMAL") {
      expect(later.items).toHaveLength(detail.heats.length - 2);
      expect(later.items[0].startMin).toBeGreaterThanOrEqual(800);
    } else expect(later.blocking.length).toBeGreaterThan(0);

    // An explicit list overrides the log; unknown ids are ignored.
    const manual = await replanShift(t.db, a, detail.plan.id, { nowMin: 800, done: [h1.id, "heat_unknown"] });
    expect(manual.heats.filter((h) => h.done).map((h) => h.id)).toEqual([h1.id]);

    const after = await t.db.select({ n: count() }).from(optimizationRuns);
    expect(after[0].n).toBe(before[0].n);
  });

  it("an operator may view it; another factory's plan is not found", async () => {
    const op = await t.actor(IDS.operatorA);
    const planId = (await getPlan(t.db, op))!.plan.id;
    expect((await replanShift(t.db, op, planId, { nowMin: 0 })).label).toBe("MODELLED");
    const b = await t.actor(IDS.ownerB);
    await expect(replanShift(t.db, b, planId)).rejects.toThrow();
  });
});
