import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, count, eq } from "drizzle-orm";
import {
  anomalies,
  heats,
  meters,
  modelFits,
  productionPlans,
  recommendations,
} from "@/db/schema";
import { getPlan } from "@/server/services/plans";
import { runOptimization } from "@/server/services/optimization";
import { getRecommendation } from "@/server/services/recommendations";
import { createHeat, updateHeat } from "@/server/services/heats";
import { analyseFactory } from "@/server/services/analysis";
import { getSettings, updateSettings } from "@/server/services/settings";
import { ingestReadings } from "@/server/services/ingest";
import { flushAnalysis } from "@/server/services/jobs";
import { hashToken } from "@/server/auth/password";
import { formatLocalDateTime } from "@/domain/time";
import { freshDb, IDS } from "../helpers/db";

let t: Awaited<ReturnType<typeof freshDb>>;
beforeAll(async () => {
  t = await freshDb();
});
afterAll(() => t.cleanup());

const iso = (ts: number | null) =>
  ts === null ? "" : formatLocalDateTime(ts, "Asia/Kolkata").replace(" ", "T");

describe("analysis stability", () => {
  it("a small data correction keeps the model, the anomaly ids and the pending recommendation", async () => {
    const sup = await t.actor(IDS.supervisorA);
    const plan = (await getPlan(t.db, sup))!;
    const run = await runOptimization(t.db, sup, plan.plan.id);
    const fits = (await t.db.select({ c: count() }).from(modelFits))[0].c;
    const ids = (await t.db.select({ id: anomalies.id }).from(anomalies))
      .map((a) => a.id)
      .sort();

    const h = (
      await t.db
        .select()
        .from(heats)
        .where(
          and(eq(heats.factoryId, IDS.facA), eq(heats.dataQuality, "COMPLETE")),
        )
        .limit(1)
    )[0];
    const op = await t.actor(IDS.operatorA);
    await updateHeat(t.db, op, h.id, h.revision, {
      heatNo: h.heatNo,
      grade: h.grade ?? "",
      orderCode: h.orderCode ?? "",
      chargeKg: h.chargeKg - 10,
      pouredKg: (h.pouredKg ?? h.chargeKg) - 10,
      startAt: iso(h.startAt),
      tapAt: iso(h.tapAt),
      mouldSet: h.mouldSet,
      mouldReadyAt: iso(h.mouldReadyAt),
      manualKwh: null,
      operatorNotes: "typo fix",
    });

    expect(
      (await getRecommendation(t.db, sup, run.recommendationId!))!.rec.status,
    ).toBe("PENDING");
    expect((await t.db.select({ c: count() }).from(modelFits))[0].c).toBe(fits);
    const after = new Set(
      (await t.db.select({ id: anomalies.id }).from(anomalies)).map(
        (a) => a.id,
      ),
    );
    // The edited heat may gain a finding; every existing anomaly keeps its id.
    expect(ids.every((id) => after.has(id))).toBe(true);
  });

  it("re-running the analysis keeps an anomaly's review status", async () => {
    const sup = await t.actor(IDS.supervisorA);
    const a = (await t.db.select().from(anomalies).limit(1))[0];
    await t.db
      .update(anomalies)
      .set({ status: "ACKNOWLEDGED" })
      .where(eq(anomalies.id, a.id));
    await analyseFactory(t.db, sup, "test");
    expect(
      (await t.db.query.anomalies.findFirst({ where: eq(anomalies.id, a.id) }))!
        .status,
    ).toBe("ACKNOWLEDGED");
  });

  it("viewing a recommendation never writes to the database", async () => {
    const sup = await t.actor(IDS.supervisorA);
    const plan = (await getPlan(t.db, sup))!;
    const run = await runOptimization(t.db, sup, plan.plan.id);
    // Change an input behind the recommendation's back, bypassing the write paths.
    await t.db
      .update(productionPlans)
      .set({ deadlineMin: plan.plan.deadlineMin - 5 })
      .where(eq(productionPlans.id, plan.plan.id));
    const viewed = await getRecommendation(t.db, sup, run.recommendationId!);
    expect(viewed!.rec.status).toBe("STALE");
    expect(
      (await t.db.query.recommendations.findFirst({
        where: eq(recommendations.id, run.recommendationId!),
      }))!.status,
    ).toBe("PENDING");
    await t.db
      .update(productionPlans)
      .set({ deadlineMin: plan.plan.deadlineMin })
      .where(eq(productionPlans.id, plan.plan.id));
  });

  it("changing process settings marks pending advice stale", async () => {
    const owner = await t.actor(IDS.ownerA);
    const plan = (await getPlan(t.db, owner))!;
    const run = await runOptimization(t.db, owner, plan.plan.id);
    const { factory: f, furnace } = await getSettings(t.db, owner);
    await updateSettings(t.db, owner, {
      holdingKw: f.holdingKw + 5,
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
    });
    expect(
      (await t.db.query.recommendations.findFirst({
        where: eq(recommendations.id, run.recommendationId!),
      }))!.status,
    ).toBe("STALE");
  });
});

describe("live data", () => {
  it("ingested readings are analysed in the background and linked to the heat", async () => {
    const ownerB = await t.actor(IDS.ownerB, IDS.facB);
    const meter = (
      await t.db.select().from(meters).where(eq(meters.factoryId, IDS.facB))
    )[0];
    const token = "eos_test_token_for_background_analysis";
    await t.db
      .update(meters)
      .set({ ingestTokenHash: hashToken(token) })
      .where(eq(meters.id, meter.id));
    const start = Date.UTC(2026, 9, 1, 4, 0); // 09:30 IST
    const id = await createHeat(t.db, ownerB, {
      heatNo: "L01",
      grade: "",
      orderCode: "",
      chargeKg: 400,
      pouredKg: 390,
      startAt: iso(start),
      tapAt: iso(start + 30 * 60000),
      mouldSet: null,
      mouldReadyAt: "",
      manualKwh: null,
      operatorNotes: "",
    });
    const readings = Array.from({ length: 30 }, (_, i) => ({
      timestamp: new Date(start + i * 60000).toISOString(),
      power_kw: 500,
    }));
    await ingestReadings(t.db, token, { readings });
    await flushAnalysis(t.db, IDS.facB);
    const h = await t.db.query.heats.findFirst({ where: eq(heats.id, id) });
    expect(h!.meterKwh).toBeCloseTo(250, 3);
    expect(h!.dataQuality).toBe("COMPLETE");
  });
});

describe("ingest endpoint", () => {
  it("rejects an oversized chunked body that has no Content-Length", async () => {
    const { POST } = await import("@/app/api/ingest/route");
    const chunk = new TextEncoder().encode("x".repeat(64 * 1024));
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent++ < 20) c.enqueue(chunk);
        else c.close();
      },
    });
    const req = new Request("http://localhost/api/ingest", { method: "POST", body, headers: { authorization: "Bearer eos_x" }, duplex: "half" } as RequestInit);
    const res = await POST(req);
    expect(res.status).toBe(413);
  });
});
