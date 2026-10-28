import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { alerts, auditEvents, meterReadings, meters, users } from "@/db/schema";
import { audit, sealAuditChain, verifyAuditChain } from "@/server/audit";
import { ingestReadings } from "@/server/services/ingest";
import { hashToken } from "@/server/auth/password";
import { addMember, changeOwnPassword, changeRole, removeMember, setDisabled } from "@/server/services/team";
import { checkWebhookUrl, raiseAlert, setAlertWebhook, deliverAlert } from "@/server/services/alerts";
import { getPlan } from "@/server/services/plans";
import { runOptimization } from "@/server/services/optimization";
import { computeVerification, DEFAULT_ASSUMPTIONS } from "@/server/services/verification";
import { availableDays } from "@/server/services/analytics";
import { checkEnv } from "@/server/env";
import { resolveActor, sessionFromToken } from "@/server/context";
import { freshDb, IDS } from "../helpers/db";

let t: Awaited<ReturnType<typeof freshDb>>;
beforeAll(async () => {
  t = await freshDb();
});
afterAll(() => t.cleanup());

describe("audit hash chain", () => {
  it("verifies, then detects an edited and a deleted event", async () => {
    const a = await t.actor(IDS.ownerB, IDS.facB);
    for (let i = 0; i < 4; i++) await audit(t.db, a, "test.event", "thing", `t${i}`, { i });
    await sealAuditChain(t.db);
    const ok = await verifyAuditChain(t.db, IDS.facB);
    expect(ok.ok).toBe(true);
    expect(ok.checked).toBeGreaterThanOrEqual(4);
    const rows = await t.db.select().from(auditEvents).where(eq(auditEvents.factoryId, IDS.facB)).orderBy(asc(auditEvents.id));
    const victim = rows[rows.length - 2];
    await t.db.update(auditEvents).set({ details: { i: 999 } }).where(eq(auditEvents.id, victim.id));
    const bad = await verifyAuditChain(t.db, IDS.facB);
    expect(bad.ok).toBe(false);
    expect(bad.firstBrokenId).toBe(victim.id);
    await t.db.update(auditEvents).set({ details: victim.details }).where(eq(auditEvents.id, victim.id));
    expect((await verifyAuditChain(t.db, IDS.facB)).ok).toBe(true);
    await t.db.delete(auditEvents).where(eq(auditEvents.id, rows[1].id));
    expect((await verifyAuditChain(t.db, IDS.facB)).ok).toBe(false);
  });
});

describe("meter ingest: counters, drift, tokens", () => {
  const token = "eos_phase2_counter_token_000000";
  const t0 = Date.UTC(2026, 8, 1, 4, 0);
  const at = (min: number, skewMs = 0) => new Date(t0 + min * 60000 + skewMs).toISOString();
  let meterId: string;
  beforeAll(async () => {
    const m = (await t.db.select().from(meters).where(eq(meters.factoryId, IDS.facB)))[0];
    meterId = m.id;
    await t.db.update(meters).set({ ingestTokenHash: hashToken(token), ingestTokenIssuedAt: Date.now() }).where(eq(meters.id, m.id));
  });
  const stored = async () => t.db.select().from(meterReadings).where(eq(meterReadings.meterId, meterId)).orderBy(asc(meterReadings.ts));

  it("turns a kWh counter into interval energy, across requests", async () => {
    await ingestReadings(t.db, token, { readings: [0, 1, 2].map((i) => ({ timestamp: at(i), energy_kwh_total: 1000 + i * 8 })) });
    let rs = await stored();
    expect(rs.map((r) => r.energyKwh)).toEqual([8, 8]); // minute 2 waits for minute 3
    await ingestReadings(t.db, token, { readings: [{ timestamp: at(3), energy_kwh_total: 1030 }] });
    rs = await stored();
    expect(rs.map((r) => Math.round(r.energyKwh * 100) / 100)).toEqual([8, 8, 14]);
    expect(rs[0].powerKw).toBeCloseTo(480, 6);
    expect((await t.db.query.meters.findFirst({ where: eq(meters.id, meterId) }))!.ingestTokenLastUsedAt).not.toBeNull();
  });

  it("handles a counter reset and snaps small clock drift", async () => {
    const r = await ingestReadings(t.db, token, {
      readings: [
        { timestamp: at(10, 2000), energy_kwh_total: 5000, power_kw: 300 },
        { timestamp: at(11), energy_kwh_total: 3 },
        { timestamp: at(12, 20_000), power_kw: 100 },
      ],
    });
    expect(r.rejected.map((x) => x.index)).toEqual([2]);
    const ten = (await stored()).find((x) => x.ts === t0 + 10 * 60000)!;
    expect(ten.energyKwh).toBeCloseTo(5, 6);
    expect(ten.qualityNote).toMatch(/backwards/);
    expect(ten.qualityNote).toMatch(/drift 2\.0s/);
  });

  it("a revoked token stops working", async () => {
    await t.db.update(meters).set({ ingestTokenHash: null }).where(eq(meters.id, meterId));
    await expect(ingestReadings(t.db, token, { readings: [{ timestamp: at(20), power_kw: 1 }] })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
});

describe("team management", () => {
  it("adds a member with a one-time password that must be changed", async () => {
    const owner = await t.actor(IDS.ownerB, IDS.facB);
    const r = await addMember(t.db, owner, { email: "New.Person@foundry-b.test", name: "New Person", role: "OPERATOR" });
    expect(r.tempPassword).toBeTruthy();
    const a = await resolveActor(t.db, r.userId, IDS.facB);
    expect(a.mustChangePassword).toBe(true);
    await changeOwnPassword(t.db, a, { current: r.tempPassword, next: "a-much-better-passphrase" }, null);
    expect((await resolveActor(t.db, r.userId, IDS.facB)).mustChangePassword).toBe(false);
    await expect(addMember(t.db, owner, { email: "new.person@foundry-b.test", name: "Again", role: "OPERATOR" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("protects the last owner and other tenants' accounts", async () => {
    const ownerB = await t.actor(IDS.ownerB, IDS.facB);
    await expect(removeMember(t.db, ownerB, IDS.ownerB)).rejects.toMatchObject({ code: "FORBIDDEN" });
    // owner A is also a member of Foundry B: B's owner cannot disable that account.
    await expect(setDisabled(t.db, ownerB, IDS.ownerA, true)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const ownerA = await t.actor(IDS.ownerA, IDS.facB);
    await expect(changeRole(t.db, ownerA, IDS.ownerB, "ANALYST")).resolves.toBeUndefined();
    await changeRole(t.db, ownerA, IDS.ownerB, "OWNER");
  });

  it("operators cannot manage the team; a disabled account loses access", async () => {
    const op = await t.actor(IDS.operatorA);
    await expect(addMember(t.db, op, { email: "x@y.test", name: "X Y", role: "OWNER" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const ownerB = await t.actor(IDS.ownerB, IDS.facB);
    const { userId } = await addMember(t.db, ownerB, { email: "temp@foundry-b.test", name: "Temp", role: "ANALYST" });
    await setDisabled(t.db, ownerB, userId, true);
    await expect(resolveActor(t.db, userId, IDS.facB)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect((await t.db.query.users.findFirst({ where: eq(users.id, userId) }))!.disabled).toBe(true);
    expect(await sessionFromToken(t.db, "x".repeat(43))).toBeNull();
  });
});

describe("alerts", () => {
  it("rejects unsafe webhook URLs", () => {
    for (const u of ["http://hooks.example.com/x", "https://localhost/x", "https://10.0.0.5/x", "https://192.168.1.2/x", "https://[::1]/x", "https://user:pw@example.com/x", "nope"]) {
      expect(() => checkWebhookUrl(u), u).toThrow();
    }
    expect(checkWebhookUrl("https://hooks.example.com/energyos")).toBe("https://hooks.example.com/energyos");
  });

  it("deduplicates and raises an approval alert for a new recommendation", async () => {
    const sup = await t.actor(IDS.supervisorA);
    const plan = (await getPlan(t.db, sup))!;
    const run = await runOptimization(t.db, sup, plan.plan.id);
    const rows = await t.db.select().from(alerts).where(and(eq(alerts.factoryId, IDS.facA), eq(alerts.kind, "APPROVAL_PENDING")));
    expect(rows.some((r) => r.href === `/recommendations/${run.recommendationId}`)).toBe(true);
    expect(await raiseAlert(t.db, sup.factory, { kind: "TEST", key: "same", title: "a", body: "b" })).not.toBeNull();
    expect(await raiseAlert(t.db, sup.factory, { kind: "TEST", key: "same", title: "a", body: "b" })).toBeNull();
  });

  it("delivers a signed payload to the webhook", async () => {
    const received: { body: string; sig: string; ts: string }[] = [];
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        received.push({ body, sig: String(req.headers["x-energyos-signature"]), ts: String(req.headers["x-energyos-timestamp"]) });
        res.end("ok");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    process.env.ALLOW_PRIVATE_WEBHOOKS = "true";
    try {
      const owner = await t.actor(IDS.ownerB, IDS.facB);
      const { secret } = await setAlertWebhook(t.db, owner, `http://127.0.0.1:${port}/hook`);
      const id = (await raiseAlert(t.db, owner.factory, { kind: "TEST", key: "deliver-1", title: "Hello", body: "World" }))!;
      await deliverAlert(t.db, id);
      expect(received.length).toBeGreaterThanOrEqual(1);
      const got = received[received.length - 1];
      expect(JSON.parse(got.body).title).toBe("Hello");
      expect(got.sig).toBe(`sha256=${createHmac("sha256", secret!).update(`${got.ts}.${got.body}`).digest("hex")}`);
      expect((await t.db.query.alerts.findFirst({ where: eq(alerts.id, id) }))!.deliveredAt).not.toBeNull();
    } finally {
      delete process.env.ALLOW_PRIVATE_WEBHOOKS;
      server.close();
    }
  });
});

describe("verification over a baseline period", () => {
  it("uses several baseline days and reports an interval", async () => {
    const a = await t.actor(IDS.supervisorA);
    const days = await availableDays(t.db, a);
    const v = await computeVerification(t.db, a, days[1], days[0], DEFAULT_ASSUMPTIONS, { baselinePeriodDays: 7 });
    expect(v.statistics.baselineDays).toBe(7);
    expect(v.statistics.secChange).not.toBeNull();
    expect(v.statistics.verdict.length).toBeGreaterThan(20);
    await expect(computeVerification(t.db, a, days[0], days[1], DEFAULT_ASSUMPTIONS, { baselinePeriodDays: 7 })).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("configuration", () => {
  it("refuses a secure deployment with the default demo password", () => {
    expect(() => checkEnv({ COOKIE_SECURE: "true", NODE_ENV: "production" } as NodeJS.ProcessEnv)).toThrow(/Refusing/);
    expect(() => checkEnv({ COOKIE_SECURE: "true", SEED_DEMO_USERS: "false", NODE_ENV: "production" } as NodeJS.ProcessEnv)).not.toThrow();
    expect(() => checkEnv({ COOKIE_SECURE: "yes" } as unknown as NodeJS.ProcessEnv)).toThrow(/Invalid configuration/);
  });
});
