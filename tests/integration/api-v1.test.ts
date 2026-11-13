import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { factories } from "@/db/schema";
import { createApiKey, revokeApiKey } from "@/server/services/apikeys";
import { clearLimit, hitLimit, isLimited } from "@/server/services/limits";
import { requestAnalysis, runPendingAnalyses } from "@/server/services/jobs";
import { storeMarketDay } from "@/server/services/market";
import { freshDb, IDS } from "../helpers/db";

let t: Awaited<ReturnType<typeof freshDb>>;
beforeAll(async () => {
  t = await freshDb();
  vi.doMock("@/db/client", async (orig) => ({ ...(await orig<typeof import("@/db/client")>()), getDb: () => t.db }));
});
afterAll(() => t.cleanup());

const get = (path: string, key?: string, ip = "5.5.5.5") =>
  new Request(`http://x${path}`, { headers: { "x-forwarded-for": ip, ...(key ? { authorization: `Bearer ${key}` } : {}) } });

describe("API keys", () => {
  it("only an owner can create one; the key is shown once and stored hashed", async () => {
    await expect(createApiKey(t.db, await t.actor(IDS.supervisorA), "BI")).rejects.toMatchObject({ code: "FORBIDDEN" });
    const k = await createApiKey(t.db, await t.actor(IDS.ownerA), "Power BI");
    expect(k.key).toMatch(/^eosk_/);
    const row = await t.db.query.apiKeys.findFirst();
    expect(row!.tokenHash).not.toContain(k.key);
    await expect(createApiKey(t.db, await t.actor(IDS.ownerA), "x")).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("GET /api/v1/*", () => {
  it("refuses requests without a valid key", async () => {
    const { GET } = await import("@/app/api/v1/summary/route");
    expect((await GET(get("/api/v1/summary?from=2026-10-20&to=2026-10-20"))).status).toBe(401);
    expect((await GET(get("/api/v1/summary?from=2026-10-20&to=2026-10-20", "eosk_not-a-real-key"))).status).toBe(401);
  });

  it("returns the key's own factory data, with rate-limit headers", async () => {
    const { key } = await createApiKey(t.db, await t.actor(IDS.ownerA), "ERP");
    const { GET } = await import("@/app/api/v1/summary/route");
    const res = await GET(get("/api/v1/summary?from=2026-10-20&to=2026-10-20", key));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-ratelimit-limit")).toBe("600");
    const body = await res.json();
    expect(body.factory.id).toBe(IDS.facA);
    expect(body.energyKwh).toBeGreaterThan(1000);
    expect(body.heats.tapped).toBeGreaterThan(0);
    const heatsRoute = await import("@/app/api/v1/heats/route");
    const h = await (await heatsRoute.GET(get("/api/v1/heats?from=2026-10-20&to=2026-10-20", key))).json();
    expect(h.count).toBeGreaterThan(0);
    expect(h.heats[0]).toHaveProperty("meterKwh");
    const recs = await import("@/app/api/v1/recommendations/route");
    expect((await recs.GET(get("/api/v1/recommendations", key))).status).toBe(200);
  });

  it("a key never sees another factory's data", async () => {
    const { key } = await createApiKey(t.db, await t.actor(IDS.ownerB, IDS.facB), "B system");
    const { GET } = await import("@/app/api/v1/heats/route");
    const body = await (await GET(get("/api/v1/heats?from=2026-10-01&to=2026-10-31", key))).json();
    expect(body.count).toBe(0);
  });

  it("validates the date range", async () => {
    const { key } = await createApiKey(t.db, await t.actor(IDS.ownerA), "Range test");
    const { GET } = await import("@/app/api/v1/summary/route");
    expect((await GET(get("/api/v1/summary?from=2026-01-01&to=2026-06-01", key))).status).toBe(400);
    expect((await GET(get("/api/v1/summary?from=bad&to=2026-06-01", key))).status).toBe(400);
  });

  it("stops working as soon as the key is revoked", async () => {
    const owner = await t.actor(IDS.ownerA);
    const k = await createApiKey(t.db, owner, "Temporary");
    const { GET } = await import("@/app/api/v1/recommendations/route");
    expect((await GET(get("/api/v1/recommendations", k.key))).status).toBe(200);
    await revokeApiKey(t.db, owner, k.id);
    expect((await GET(get("/api/v1/recommendations", k.key))).status).toBe(401);
  });

  it("serves the public market data and the OpenAPI description without a key", async () => {
    const market = await import("@/app/api/v1/market/route");
    expect((await market.GET()).status).toBe(404); // nothing fetched yet
    await storeMarketDay(t.db, { date: "2026-11-05", blocks: Array.from({ length: 96 }, (_, i) => ({ block: i + 1, startMin: i * 15, mcpRsPerMwh: 4000 + i, mcvMw: 5000, purchaseBidMw: 9000, sellBidMw: 8000 })) }, Date.now());
    const m = await (await market.GET()).json();
    expect(m.blocks).toHaveLength(96);
    expect(m.deliveryDate).toBe("2026-11-05");
    const spec = await import("@/app/api/v1/openapi.json/route");
    const s = await spec.GET(new Request("http://x/api/v1/openapi.json")).json();
    expect(s.openapi).toBe("3.1.0");
    expect(Object.keys(s.paths)).toContain("/api/v1/summary");
  });
});

describe("shared rate limits", () => {
  it("counts hits atomically and resets after the window", async () => {
    const now = 1_000_000;
    const results = await Promise.all(Array.from({ length: 8 }, () => hitLimit(t.db, "test:k", 5, 60_000, now)));
    expect(results.map((r) => r.count).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    expect(await isLimited(t.db, "test:k", 5, now + 1)).toBe(true);
    expect((await hitLimit(t.db, "test:k", 5, 60_000, now + 60_001)).count).toBe(1);
    await clearLimit(t.db, "test:k");
    expect(await isLimited(t.db, "test:k", 5, now + 60_002)).toBe(false);
  });
});

describe("durable analysis queue", () => {
  it("is claimed once, respects the debounce, and clears the request", async () => {
    await requestAnalysis(t.db, IDS.facA, 1_000);
    await requestAnalysis(t.db, IDS.facA, 5_000); // keeps the earliest request
    const f = await t.db.query.factories.findFirst({ where: eq(factories.id, IDS.facA) });
    expect(f!.analysisRequestedAt).toBe(1_000);
    expect(await runPendingAnalyses(t.db, 60_000, 30_000)).toEqual([]); // still inside the debounce
    const [a, b] = await Promise.all([runPendingAnalyses(t.db, 60_000, 100_000), runPendingAnalyses(t.db, 60_000, 100_000)]);
    expect([...a, ...b]).toEqual([IDS.facA]); // exactly one runner did the work
    const after = await t.db.query.factories.findFirst({ where: eq(factories.id, IDS.facA) });
    expect(after!.analysisRequestedAt).toBeNull();
  });
});

describe("POST /api/cron/tick", () => {
  it("is off without CRON_SECRET, refuses a wrong secret, runs with the right one", async () => {
    const { POST } = await import("@/app/api/cron/tick/route");
    const req = (s?: string) => new Request("http://x/api/cron/tick", { method: "POST", headers: s ? { authorization: `Bearer ${s}` } : {} });
    delete process.env.CRON_SECRET;
    expect((await POST(req("x"))).status).toBe(404);
    process.env.CRON_SECRET = "a-long-test-secret-value";
    process.env.INDIA_MARKET_FEED = "off";
    try {
      expect((await POST(req("wrong"))).status).toBe(401);
      const ok = await POST(req("a-long-test-secret-value"));
      expect(ok.status).toBe(200);
      const body = await ok.json();
      expect(body.ok).toBe(true);
      expect(body.sealed).toBe(true);
    } finally {
      delete process.env.CRON_SECRET;
      delete process.env.INDIA_MARKET_FEED;
    }
  });
});
