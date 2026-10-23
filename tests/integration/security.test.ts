import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { heats } from "@/db/schema";
import { actorForFactory } from "@/server/context";
import { createHeat, getHeat, listHeats, updateHeat } from "@/server/services/heats";
import { runOptimization } from "@/server/services/optimization";
import { decideRecommendation, getRecommendation } from "@/server/services/recommendations";
import { createTariffVersion } from "@/server/services/tariffs";
import { resetScenario } from "@/server/services/demo";
import { buildExport } from "@/server/services/exports";
import { getPlan } from "@/server/services/plans";
import { verifyPassword } from "@/server/auth/password";
import { freshDb, IDS } from "../helpers/db";

let t: Awaited<ReturnType<typeof freshDb>>;
beforeAll(async () => {
  t = await freshDb();
});
afterAll(() => t.cleanup());

describe("tenant isolation", () => {
  it("a user cannot switch into a factory they do not belong to", async () => {
    await expect(actorForFactory(t.db, IDS.ownerB, IDS.facA)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("factory B sees none of factory A's heats, plans or recommendations", async () => {
    const a = await t.actor(IDS.supervisorA);
    const b = await t.actor(IDS.ownerB, IDS.facB);
    const aHeat = await t.db.query.heats.findFirst({ where: eq(heats.factoryId, IDS.facA) });
    expect(aHeat).toBeTruthy();
    expect((await listHeats(t.db, b, {})).total).toBe(0);
    expect(await getHeat(t.db, b, aHeat!.id)).toBeNull();
    await expect(updateHeat(t.db, b, aHeat!.id, aHeat!.revision, {})).rejects.toMatchObject({ code: "NOT_FOUND" });
    const plan = (await getPlan(t.db, a))!;
    expect(await getPlan(t.db, b, plan.plan.id)).toBeNull();
    const run = await runOptimization(t.db, a, plan.plan.id);
    expect(run.recommendationId).toBeTruthy();
    expect(await getRecommendation(t.db, b, run.recommendationId!)).toBeNull();
    await expect(decideRecommendation(t.db, b, { recommendationId: run.recommendationId, decision: "APPROVED", expectedVersion: 1 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(runOptimization(t.db, b, plan.plan.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("exports only contain the actor's factory", async () => {
    const b = await t.actor(IDS.ownerB, IDS.facB);
    const out = await buildExport(t.db, b, "heats", "2026-10-01", "2026-10-21");
    expect(out.csv).not.toContain("FDY-A");
    expect(out.csv.split("\n").filter((l) => l && !l.startsWith("#")).length).toBe(1); // header only
  });

  it("the owner of both factories gets factory B data only when acting in factory B", async () => {
    const asB = await t.actor(IDS.ownerA, IDS.facB);
    expect(asB.factory.id).toBe(IDS.facB);
    expect((await listHeats(t.db, asB, {})).total).toBe(0);
  });
});

describe("role permissions are enforced on the server", () => {
  it("operator cannot run the optimiser or decide", async () => {
    const op = await t.actor(IDS.operatorA);
    const plan = (await getPlan(t.db, op))!;
    await expect(runOptimization(t.db, op, plan.plan.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(decideRecommendation(t.db, op, { recommendationId: "x", decision: "APPROVED", expectedVersion: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(resetScenario(t.db, op, "holding-anomaly")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("analyst can run the optimiser but cannot approve", async () => {
    const an = await t.actor(IDS.analystA);
    const plan = (await getPlan(t.db, an))!;
    const r = await runOptimization(t.db, an, plan.plan.id);
    expect(r.status).toBe("OPTIMAL");
    await expect(decideRecommendation(t.db, an, { recommendationId: r.recommendationId, decision: "APPROVED", expectedVersion: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("supervisor cannot edit tariffs; analyst cannot log heats", async () => {
    const sup = await t.actor(IDS.supervisorA);
    await expect(createTariffVersion(t.db, sup, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    const an = await t.actor(IDS.analystA);
    await expect(createHeat(t.db, an, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("demo reset is refused for a real factory", async () => {
    const b = await t.actor(IDS.ownerB, IDS.facB);
    await expect(resetScenario(t.db, b, "holding-anomaly")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("credentials", () => {
  it("stores passwords as scrypt hashes, never plaintext", async () => {
    const u = await t.db.query.users.findFirst();
    expect(u!.passwordHash).not.toContain("test-password");
    expect(await verifyPassword("test-password", u!.passwordHash)).toBe(true);
    expect(await verifyPassword("wrong", u!.passwordHash)).toBe(false);
  });
});

describe("heat records", () => {
  const base = { heatNo: "T01", grade: "FG260", orderCode: "", chargeKg: 480, pouredKg: 470, startAt: "2026-10-19T23:00", tapAt: "2026-10-19T23:45", mouldSet: null, mouldReadyAt: "", manualKwh: 300, operatorNotes: "test" };
  it("creates, validates and edits with optimistic concurrency and audit", async () => {
    const op = await t.actor(IDS.operatorA);
    await expect(createHeat(t.db, op, { ...base, chargeKg: 900 })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(createHeat(t.db, op, { ...base, tapAt: "2026-10-19T22:00" })).rejects.toMatchObject({ code: "VALIDATION" });
    const id = await createHeat(t.db, op, base);
    const h = (await getHeat(t.db, op, id))!.h;
    expect(h.provenance).toBe("MANUAL");
    expect(h.revision).toBe(1);
    await expect(createHeat(t.db, op, { ...base, heatNo: "T02", startAt: "2026-10-19T23:30", tapAt: "2026-10-19T23:55" })).rejects.toMatchObject({ code: "VALIDATION" });
    await updateHeat(t.db, op, id, 1, { ...base, pouredKg: 460 });
    await expect(updateHeat(t.db, op, id, 1, { ...base, pouredKg: 450 })).rejects.toMatchObject({ code: "STALE" });
    const after = (await getHeat(t.db, op, id))!.h;
    expect(after.pouredKg).toBe(460);
    expect(after.revision).toBe(2);
    const events = await t.db.query.auditEvents.findMany({ where: (e, { eq }) => eq(e.entityId, id) });
    expect(events.map((e) => e.action).sort()).toEqual(["heat.create", "heat.update"]);
    const upd = events.find((e) => e.action === "heat.update")!;
    expect((upd.details as { changes: Record<string, unknown> }).changes.pouredKg).toEqual({ from: 470, to: 460 });
    const stored = await t.db.query.heats.findFirst({ where: and(eq(heats.id, id), eq(heats.factoryId, IDS.facA)) });
    expect(stored!.updatedBy).toBe(IDS.operatorA);
  });
});
