import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { latestMarketDay, MARKET_MIN_INTERVAL_MS, refreshIexDam } from "@/server/services/market";
import { freshDb } from "../helpers/db";

const PAGE = readFileSync(path.join(__dirname, "../fixtures/iex-dam-snapshot.html"), "utf8");
const ok = (async () => new Response(PAGE, { status: 200 })) as unknown as typeof fetch;
let t: Awaited<ReturnType<typeof freshDb>>;
beforeAll(async () => {
  t = await freshDb();
});
afterAll(() => t.cleanup());

describe("IEX market feed", () => {
  it("has no data before the first fetch", async () => {
    expect(await latestMarketDay(t.db)).toBeNull();
  });

  it("stores a parsed day and reads it back", async () => {
    const r = await refreshIexDam(t.db, ok, 1_000_000);
    expect(r).toEqual({ ok: true, date: "2026-11-05", blocks: 96 });
    const d = (await latestMarketDay(t.db))!;
    expect(d.date).toBe("2026-11-05");
    expect(d.blocks).toHaveLength(96);
    expect(d.fetchedAt).toBe(1_000_000);
  });

  it("throttles repeated fetches", async () => {
    let calls = 0;
    const counting = (async () => (calls++, new Response(PAGE))) as unknown as typeof fetch;
    const r = await refreshIexDam(t.db, counting, 1_000_000 + 60_000);
    expect(r.ok).toBe(false);
    expect(calls).toBe(0);
    expect((await refreshIexDam(t.db, counting, 1_000_000 + MARKET_MIN_INTERVAL_MS + 1)).ok).toBe(true);
    expect(calls).toBe(1);
  });

  it("keeps stored prices when IEX is down, errors or changes its page", async () => {
    const later = 10_000_000;
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const http500 = (async () => new Response("err", { status: 500 })) as unknown as typeof fetch;
    const changed = (async () => new Response("<html>new layout</html>")) as unknown as typeof fetch;
    for (const [f, i] of [[down, 1], [http500, 2], [changed, 3]] as const) {
      const r = await refreshIexDam(t.db, f, later + i * MARKET_MIN_INTERVAL_MS * 2);
      expect(r.ok).toBe(false);
    }
    expect((await latestMarketDay(t.db))!.blocks).toHaveLength(96);
  });

  it("can be switched off", async () => {
    process.env.INDIA_MARKET_FEED = "off";
    try {
      const r = await refreshIexDam(t.db, ok, 99_000_000);
      expect(r).toMatchObject({ ok: false });
    } finally {
      delete process.env.INDIA_MARKET_FEED;
    }
  });
});
