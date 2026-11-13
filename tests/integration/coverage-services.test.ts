import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { recommendations } from "@/db/schema";
import { buildExport, csvCell, EXPORT_KINDS, toCsv } from "@/server/services/exports";
import { createTariffVersion, listTariffVersions, previewRate } from "@/server/services/tariffs";
import { createPlan, getPlan, listPlans, updatePlan } from "@/server/services/plans";
import { runOptimization } from "@/server/services/optimization";
import { analyseAsSystem, flushAnalysis, scheduleAnalysis } from "@/server/services/jobs";
import { freshDb, IDS } from "../helpers/db";

let t: Awaited<ReturnType<typeof freshDb>>;
beforeAll(async () => {
  t = await freshDb();
});
afterAll(() => t.cleanup());

describe("exports", () => {
  it("builds every export kind with a metadata header and a simulation notice", async () => {
    const a = await t.actor(IDS.supervisorA);
    const day = (await t.db.query.heats.findFirst())!.dayDate;
    for (const kind of EXPORT_KINDS) {
      if (kind === "audit" && a.role !== "OWNER") continue;
      const { filename, csv } = await buildExport(t.db, a, kind, day, day);
      expect(filename).toContain(kind);
      expect(csv).toMatch(/^# FactoryTwin EnergyOS export: /);
      expect(csv).toMatch(/SIMULATION/);
    }
  });
  it("rejects unknown kinds, inverted and over-long ranges", async () => {
    const a = await t.actor(IDS.supervisorA);
    await expect(buildExport(t.db, a, "nope", "2026-09-01", "2026-09-02")).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(buildExport(t.db, a, "heats", "2026-09-05", "2026-09-01")).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(buildExport(t.db, a, "heats", "2026-01-01", "2026-06-01")).rejects.toMatchObject({ code: "VALIDATION" });
  });
  it("neutralises formula injection and quotes awkward cells", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell(Number.NaN)).toBe("");
    expect(toCsv({ k: "v\nw" }, ["x"], [["1"]])).toBe("# k: v w\nx\n1\n");
  });
});

describe("tariffs", () => {
  const valid = {
    name: "Test tariff",
    effectiveFrom: "2026-11-01T00:00",
    normalRate: 7,
    evidence: "ASSUMPTION",
    sourceNote: "",
    periods: [{ kind: "PEAK", label: "Peak", start: "18:00", end: "22:00", rate: 10 }],
  };
  it("creates a new version, stales a pending recommendation and lists newest first", async () => {
    const sup = await t.actor(IDS.supervisorA);
    const an = await t.actor(IDS.analystA);
    const planId = (await getPlan(t.db, sup))!.plan.id;
    const run = await runOptimization(t.db, sup, planId);
    expect(run.recommendationId).toBeTruthy();
    const r = await createTariffVersion(t.db, await t.actor(IDS.ownerA), valid);
    expect(r.version).toBeGreaterThan(1);
    const rec = await t.db.query.recommendations.findFirst({ where: eq(recommendations.id, run.recommendationId!) });
    expect(rec!.status).toBe("STALE");
    const list = await listTariffVersions(t.db, an);
    expect(list[0].version).toBe(r.version);
  });
  it("validates inputs", async () => {
    const o = await t.actor(IDS.ownerA);
    await expect(createTariffVersion(t.db, o, { ...valid, evidence: "VERIFIED" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(createTariffVersion(t.db, o, { ...valid, normalRate: 0 })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(createTariffVersion(t.db, o, { ...valid, periods: [{ kind: "PEAK", label: "a", start: "10:00", end: "14:00", rate: 5 }, { kind: "SOLAR", label: "b", start: "12:00", end: "16:00", rate: 5 }] })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(createTariffVersion(t.db, o, { ...valid, periods: [{ kind: "PEAK", label: "a", start: "xx", end: "14:00", rate: 5 }] })).rejects.toMatchObject({ code: "VALIDATION" });
  });
  it("previews the rate at a local time", async () => {
    const a = await t.actor(IDS.operatorA);
    const p = await previewRate(t.db, a, "2026-11-10T19:00");
    expect(p.rate?.kind).toBe("PEAK");
    await expect(previewRate(t.db, a, "bad")).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("plans", () => {
  it("rejects an edit against a stale revision and a bad downtime block", async () => {
    const a = await t.actor(IDS.analystA);
    const d = (await getPlan(t.db, a))!;
    const body = {
      planId: d.plan.id,
      expectedRevision: d.plan.revision,
      deadlineMin: d.plan.deadlineMin,
      currentPracticeStartMin: d.plan.currentPracticeStartMin,
      downtime: [],
      orders: d.orders.map((o) => ({ id: o.id, requiredTonnes: o.requiredTonnes, dueMin: o.dueMin })),
      mould: [],
    };
    await expect(updatePlan(t.db, a, { ...body, downtime: [{ fromMin: 700, toMin: 600, reason: "x" }] })).rejects.toMatchObject({ code: "VALIDATION" });
    await updatePlan(t.db, a, body);
    await expect(updatePlan(t.db, a, body)).rejects.toMatchObject({ code: "STALE" });
    expect((await listPlans(t.db, a)).length).toBeGreaterThan(0);
  });
  it("creates a plan in a real factory and refuses one in a simulation factory", async () => {
    const b = await t.actor(IDS.ownerB, IDS.facB);
    const body = { planDate: "2026-11-20", heatsCount: 4, chargeKg: 450, orderCode: "PO-1", grade: "SG 500/7", deadlineMin: 1020 };
    const r = await createPlan(t.db, b, body);
    expect(r).toBeTruthy();
    const d = await getPlan(t.db, b);
    expect(d!.heats).toHaveLength(4);
    await expect(createPlan(t.db, b, { ...body, heatsCount: 0 })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(createPlan(t.db, await t.actor(IDS.ownerA), body)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("an operator cannot edit plans", async () => {
    const o = await t.actor(IDS.operatorA);
    await expect(updatePlan(t.db, o, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("background analysis", () => {
  it("debounces and flushes per factory, and ignores unknown factories", async () => {
    await scheduleAnalysis(t.db, IDS.facA, 60_000);
    await scheduleAnalysis(t.db, IDS.facA, 60_000); // second call replaces the first timer
    await flushAnalysis(t.db, IDS.facA);
    expect(await analyseAsSystem(t.db, "fac_missing", "test")).toBeNull();
    expect(await analyseAsSystem(t.db, IDS.facA, "test")).not.toBeNull();
  });
});
