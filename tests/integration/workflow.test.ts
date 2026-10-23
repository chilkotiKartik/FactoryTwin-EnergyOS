import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { and, count, eq } from "drizzle-orm";
import { approvals, auditEvents, heats, meterReadings, meters, recommendations } from "@/db/schema";
import { createDb } from "@/db/client";
import { hashToken } from "@/server/auth/password";
import { getPlan, updatePlan } from "@/server/services/plans";
import { runOptimization } from "@/server/services/optimization";
import { activeSchedule, decideRecommendation, getRecommendation } from "@/server/services/recommendations";
import { recordSimulatedOutcome } from "@/server/services/execution";
import { computeVerification, createVerificationReport, DEFAULT_ASSUMPTIONS } from "@/server/services/verification";
import { commitCsv, previewCsv } from "@/server/services/meters";
import { ingestReadings } from "@/server/services/ingest";
import { dataMode, rangeSummary } from "@/server/services/analytics";
import { createHeat } from "@/server/services/heats";
import { resetScenario } from "@/server/services/demo";
import { createTariffVersion } from "@/server/services/tariffs";
import { AS_RUN_DATE, PLAN_DATE } from "@/domain/scenarios";
import { freshDb, IDS } from "../helpers/db";

let t: Awaited<ReturnType<typeof freshDb>>;
beforeAll(async () => {
  t = await freshDb();
});
afterAll(() => t.cleanup());

describe("seeded holding-anomaly scenario", () => {
  it("reproduces the deck's as-run day and flags Heat 07", async () => {
    const a = await t.actor(IDS.supervisorA);
    const s = await rangeSummary(t.db, a, AS_RUN_DATE, AS_RUN_DATE);
    expect(s.heatsTapped).toBe(12);
    expect(s.tonnesPoured).toBe(6);
    expect(s.holdingMinutes).toBe(138);
    expect(s.sec!).toBeGreaterThan(660);
    expect(s.sec!).toBeLessThan(690);
    expect(s.evidence).toBe("SIMULATED");
    const h7 = s.heats.find((h) => h.heatNo === "H07")!;
    expect(h7.anomalySeverity).toBe("HIGH");
    expect(h7.holdingMinutes).toBe(45);
  });
});

describe("recommendation → decision → outcome → verification", () => {
  let recId: string;
  it("creates a pending, modelled recommendation", async () => {
    const a = await t.actor(IDS.supervisorA);
    const plan = (await getPlan(t.db, a))!;
    const r = await runOptimization(t.db, a, plan.plan.id);
    expect(r.status).toBe("OPTIMAL");
    recId = r.recommendationId!;
    const d = (await getRecommendation(t.db, a, recId))!;
    expect(d.rec.status).toBe("PENDING");
    expect((d.rec.predicted as { label: string }).label).toBe("MODELLED");
  });

  it("goes stale when plan inputs change, and a stale recommendation cannot be approved", async () => {
    const a = await t.actor(IDS.supervisorA);
    const plan = (await getPlan(t.db, a))!;
    await updatePlan(t.db, a, {
      planId: plan.plan.id,
      expectedRevision: plan.plan.revision,
      deadlineMin: 21 * 60 + 30,
      currentPracticeStartMin: plan.plan.currentPracticeStartMin,
      downtime: [],
      orders: plan.orders.map((o) => ({ id: o.id, requiredTonnes: o.requiredTonnes, dueMin: 21 * 60 + 30 })),
      mould: plan.heats.map((h) => ({ mouldSet: h.mouldSet!, readyMin: h.mouldReadyMin })),
    });
    await expect(decideRecommendation(t.db, a, { recommendationId: recId, decision: "APPROVED", expectedVersion: 1 })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await t.db.query.recommendations.findFirst({ where: eq(recommendations.id, recId) }))!.status).toBe("STALE");
  });

  it("a tariff change also makes a pending recommendation stale", async () => {
    const a = await t.actor(IDS.supervisorA);
    const plan = (await getPlan(t.db, a))!;
    const r = await runOptimization(t.db, a, plan.plan.id);
    const analyst = await t.actor(IDS.analystA);
    await createTariffVersion(t.db, analyst, { name: "Test tariff", effectiveFrom: "2026-12-01T00:00", normalRate: 8, evidence: "ASSUMPTION", sourceNote: "", periods: [] });
    expect((await t.db.query.recommendations.findFirst({ where: eq(recommendations.id, r.recommendationId!) }))!.status).toBe("STALE");
  });

  it("rejection needs a reason and records who, when and why", async () => {
    const a = await t.actor(IDS.supervisorA);
    const plan = (await getPlan(t.db, a))!;
    const r = await runOptimization(t.db, a, plan.plan.id);
    const rec = (await getRecommendation(t.db, a, r.recommendationId!))!;
    await expect(decideRecommendation(t.db, a, { recommendationId: rec.rec.id, decision: "REJECTED", reason: "", expectedVersion: rec.rec.version })).rejects.toMatchObject({ code: "VALIDATION" });
    await decideRecommendation(t.db, a, { recommendationId: rec.rec.id, decision: "REJECTED", reason: "Mould line short-staffed", expectedVersion: rec.rec.version });
    const ap = await t.db.query.approvals.findFirst({ where: eq(approvals.recommendationId, rec.rec.id) });
    expect(ap).toMatchObject({ decision: "REJECTED", actorId: IDS.supervisorA, actorRole: "SUPERVISOR", reason: "Mould line short-staffed" });
    // Current practice remains the active schedule.
    expect((await activeSchedule(t.db, a, plan.plan.id))!.version.kind).toBe("CURRENT_PRACTICE");
  });

  it("approval activates the schedule once; a second decision is refused", async () => {
    const a = await t.actor(IDS.supervisorA);
    const plan = (await getPlan(t.db, a))!;
    const r = await runOptimization(t.db, a, plan.plan.id);
    recId = r.recommendationId!;
    const rec = (await getRecommendation(t.db, a, recId))!;
    await decideRecommendation(t.db, a, { recommendationId: recId, decision: "APPROVED", reason: "", expectedVersion: rec.rec.version });
    await expect(decideRecommendation(t.db, a, { recommendationId: recId, decision: "APPROVED", reason: "", expectedVersion: rec.rec.version })).rejects.toMatchObject({ code: "CONFLICT" });
    const owner = await t.actor(IDS.ownerA);
    await expect(decideRecommendation(t.db, owner, { recommendationId: recId, decision: "REJECTED", reason: "too late now", expectedVersion: rec.rec.version })).rejects.toMatchObject({ code: "CONFLICT" });
    const n = await t.db.select({ c: count() }).from(approvals).where(eq(approvals.recommendationId, recId));
    expect(n[0].c).toBe(1);
    const active = (await activeSchedule(t.db, a, plan.plan.id))!;
    expect(active.version.kind).toBe("RECOMMENDED");
    const ev = await t.db.select().from(auditEvents).where(and(eq(auditEvents.entityId, recId), eq(auditEvents.action, "recommendation.approve")));
    expect(ev).toHaveLength(1);
    expect((ev[0].details as { note: string }).note).toMatch(/No command was sent/);
  });

  it("records a SIMULATED outcome and verifies savings per tonne", async () => {
    const a = await t.actor(IDS.supervisorA);
    const plan = (await getPlan(t.db, a))!;
    await recordSimulatedOutcome(t.db, a, plan.plan.id);
    await expect(recordSimulatedOutcome(t.db, a, plan.plan.id)).rejects.toMatchObject({ code: "CONFLICT" });
    const v = await computeVerification(t.db, a, AS_RUN_DATE, PLAN_DATE, DEFAULT_ASSUMPTIONS);
    expect(v.evidenceLabel).toBe("SIMULATED");
    expect(v.comparison.holdingMinutes).toBe(0);
    expect(v.savings.secChangePercent!).toBeLessThan(-2);
    expect(v.savings.costPerTonneChangePercent!).toBeLessThan(-5);
    expect(v.avoidedEmissionsKg!).toBeGreaterThan(0);
    expect(v.payback.status).toBe("PAYS_BACK");
    expect(v.prediction).not.toBeNull();
    const id = await createVerificationReport(t.db, a, { baselineDay: AS_RUN_DATE, comparisonDay: PLAN_DATE, assumptions: DEFAULT_ASSUMPTIONS });
    const rep = await t.db.query.verificationReports.findFirst({ where: (r, { eq }) => eq(r.id, id) });
    expect(rep!.evidenceLabel).toBe("SIMULATED");
  });
});

describe("CSV import", () => {
  const csv = readFileSync("public/samples/meter-sample-with-errors.csv", "utf8");
  it("previews row statuses without storing anything", async () => {
    const a = await t.actor(IDS.analystA);
    const before = await t.db.select({ c: count() }).from(meterReadings);
    const p = await previewCsv(t.db, a, "mtr_a_f1", "sample.csv", csv);
    expect(p.fatal).toBeNull();
    expect(p.counts.DUPLICATE_IN_FILE).toBe(1);
    expect(p.counts.REJECT).toBe(5);
    expect(p.counts.SUSPECT).toBe(1);
    expect(p.counts.ACCEPT).toBe(60);
    const after = await t.db.select({ c: count() }).from(meterReadings);
    expect(after[0].c).toBe(before[0].c);
  });
  it("commits only valid rows, labels them SIMULATED in a simulation factory, and skips re-imports", async () => {
    const a = await t.actor(IDS.analystA);
    const r = await commitCsv(t.db, a, "mtr_a_f1", "sample.csv", csv, "GENUINE_METER_EXPORT");
    expect(r.accepted).toBe(61);
    expect(r.provenance).toBe("SIMULATED");
    const again = await previewCsv(t.db, a, "mtr_a_f1", "sample.csv", csv);
    expect(again.counts.DUPLICATE_EXISTING).toBe(61);
  });
  it("refuses a meter from another factory", async () => {
    const a = await t.actor(IDS.analystA);
    await expect(previewCsv(t.db, a, "mtr_b_f1", "x.csv", csv)).rejects.toMatchObject({ code: "VALIDATION" });
  });
  it("labels a declared genuine export MEASURED only in a real factory", async () => {
    const b = await t.actor(IDS.ownerB, IDS.facB);
    const r = await commitCsv(t.db, b, "mtr_b_f1", "b.csv", "timestamp,power_kw\n2026-10-20 10:00,500\n2026-10-20 10:01,505\n", "GENUINE_METER_EXPORT");
    expect(r.provenance).toBe("MEASURED");
    const u = await commitCsv(t.db, b, "mtr_b_f1", "c.csv", "timestamp,power_kw\n2026-10-20 11:00,500\n", "UNVERIFIED");
    expect(u.provenance).toBe("IMPORTED_UNVERIFIED");
  });
});

describe("data mode and meter ingest", () => {
  it("shows OFFLINE without fresh measured data, LIVE only after valid live readings", async () => {
    const b = await t.actor(IDS.ownerB, IDS.facB);
    expect((await dataMode(t.db, b)).mode).toBe("OFFLINE");
    const token = "eos_test_token_0123456789abcdef";
    await t.db.update(meters).set({ ingestTokenHash: hashToken(token) }).where(eq(meters.id, "mtr_b_f1"));
    await expect(ingestReadings(t.db, "eos_wrong_token_000000000000", { readings: [] })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    const now = Math.floor(Date.now() / 60000) * 60000 - 60000;
    const res = await ingestReadings(t.db, token, {
      readings: [
        { timestamp: new Date(now).toISOString(), power_kw: 500 },
        { timestamp: new Date(now - 60000).toISOString(), power_kw: -4 },
      ],
    });
    expect(res.accepted).toBe(1);
    expect(res.rejected).toHaveLength(1);
    expect((await dataMode(t.db, b)).mode).toBe("LIVE");
  });
  it("simulation factories never show LIVE and refuse live ingest", async () => {
    const a = await t.actor(IDS.supervisorA);
    expect((await dataMode(t.db, a)).mode).toBe("SIMULATION");
    const token = "eos_sim_token_0123456789abcdef";
    await t.db.update(meters).set({ ingestTokenHash: hashToken(token) }).where(eq(meters.id, "mtr_a_f1"));
    await expect(ingestReadings(t.db, token, { readings: [{ timestamp: new Date().toISOString(), power_kw: 1 }] })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("scenarios and reset", () => {
  it("missing readings pause advice; infeasible plan reports blocking constraints", async () => {
    const sup = await t.actor(IDS.supervisorA);
    await resetScenario(t.db, sup, "missing-readings");
    const a = await t.actor(IDS.supervisorA);
    let plan = (await getPlan(t.db, a))!;
    const paused = await runOptimization(t.db, a, plan.plan.id);
    expect(paused.status).toBe("PAUSED_DATA_QUALITY");
    expect(paused.recommendationId).toBeNull();
    await resetScenario(t.db, a, "infeasible");
    plan = (await getPlan(t.db, a))!;
    const inf = await runOptimization(t.db, a, plan.plan.id);
    expect(inf.status).toBe("INFEASIBLE");
    expect(inf.message).toMatch(/No feasible schedule/);
  });
  it("reset does not touch another factory's data or the audit log", async () => {
    const b = await t.actor(IDS.ownerB, IDS.facB);
    await createHeat(t.db, b, { heatNo: "B01", grade: "SG", orderCode: "", chargeKg: 900, pouredKg: 880, startAt: "2026-10-20T08:00", tapAt: "2026-10-20T08:50", mouldSet: null, mouldReadyAt: "", manualKwh: 600, operatorNotes: "" });
    const auditBefore = await t.db.select({ c: count() }).from(auditEvents);
    const a = await t.actor(IDS.supervisorA);
    await resetScenario(t.db, a, "holding-anomaly");
    expect(await t.db.query.heats.findFirst({ where: and(eq(heats.factoryId, IDS.facB), eq(heats.heatNo, "B01")) })).toBeTruthy();
    expect((await t.db.select({ c: count() }).from(meterReadings).where(eq(meterReadings.factoryId, IDS.facB)))[0].c).toBeGreaterThan(0);
    const auditAfter = await t.db.select({ c: count() }).from(auditEvents);
    expect(auditAfter[0].c).toBeGreaterThan(auditBefore[0].c);
  });
  it("is deterministic: the same scenario produces the same energy", async () => {
    const a = await t.actor(IDS.supervisorA);
    const first = await rangeSummary(t.db, a, AS_RUN_DATE, AS_RUN_DATE);
    await resetScenario(t.db, a, "holding-anomaly");
    const second = await rangeSummary(t.db, a, AS_RUN_DATE, AS_RUN_DATE);
    expect(second.energyKwh).toBeCloseTo(first.energyKwh, 6);
  });
});

describe("persistence", () => {
  it("data survives closing and reopening the database", async () => {
    const a = await t.actor(IDS.supervisorA);
    const before = await rangeSummary(t.db, a, AS_RUN_DATE, AS_RUN_DATE);
    const { db, client } = createDb(t.url);
    const n = await db.select({ c: count() }).from(heats).where(eq(heats.factoryId, IDS.facA));
    expect(n[0].c).toBeGreaterThan(300);
    const r = await db.select({ c: count() }).from(meterReadings).where(and(eq(meterReadings.factoryId, IDS.facA)));
    expect(r[0].c).toBeGreaterThanOrEqual(before.readingCount);
    client.close();
  });
});
