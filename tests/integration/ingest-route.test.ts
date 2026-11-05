import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { freshDb } from "../helpers/db";

let t: Awaited<ReturnType<typeof freshDb>>;
beforeAll(async () => {
  t = await freshDb();
  vi.doMock("@/db/client", async (orig) => ({ ...(await orig<typeof import("@/db/client")>()), getDb: () => t.db }));
});
afterAll(() => t.cleanup());

const req = (token: string | null, ip: string, body: unknown = { readings: [] }) =>
  new Request("http://x/api/ingest", {
    method: "POST",
    headers: { "x-forwarded-for": ip, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

describe("POST /api/ingest throttling", () => {
  it("throttles an address that keeps presenting unknown tokens, even when rotating them", async () => {
    const { POST } = await import("@/app/api/ingest/route");
    const codes: number[] = [];
    for (let i = 0; i < 25; i++) codes.push((await POST(req(`eos_random${i}`, "9.9.9.9"))).status);
    expect(codes.slice(0, 20).every((c) => c === 401)).toBe(true);
    expect(codes.slice(21).every((c) => c === 429)).toBe(true);
    // Another address is unaffected.
    expect((await POST(req("eos_other", "8.8.8.8"))).status).toBe(401);
  });

  it("rejects an oversized chunked body", async () => {
    const { POST } = await import("@/app/api/ingest/route");
    const big = "x".repeat(600 * 1024);
    const res = await POST(new Request("http://x/api/ingest", { method: "POST", headers: { "x-forwarded-for": "7.7.7.7" }, body: big }));
    expect(res.status).toBe(413);
  });
});
