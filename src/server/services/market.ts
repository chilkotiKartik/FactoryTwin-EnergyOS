import { and, desc, eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { marketPrices } from "@/db/schema";
import { IEX_DAM_URL, IEX_SOURCE, parseIexDamSnapshot, type MarketDay } from "@/domain/iex";

/** Never ask IEX more often than this, whatever triggers the refresh. */
export const MARKET_MIN_INTERVAL_MS = 5 * 60_000;
const TIMEOUT_MS = 10_000;

export type MarketRefresh = { ok: true; date: string; blocks: number } | { ok: false; reason: string };

/** Is the live market feed enabled? (INDIA_MARKET_FEED=off disables it, e.g. for an offline plant network.) */
export function marketFeedEnabled(env: NodeJS.ProcessEnv = process.env) {
  return (env.INDIA_MARKET_FEED ?? "iex") !== "off";
}

/**
 * Fetch today's IEX Day-Ahead Market prices and store them. Read-only and public:
 * one GET of the public snapshot page. A failure leaves the stored data as it was.
 */
export async function refreshIexDam(db: DB, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<MarketRefresh> {
  if (!marketFeedEnabled()) return { ok: false, reason: "The live market feed is turned off (INDIA_MARKET_FEED=off)." };
  const last = await db.select({ t: marketPrices.fetchedAt }).from(marketPrices).where(eq(marketPrices.source, IEX_SOURCE)).orderBy(desc(marketPrices.fetchedAt)).limit(1);
  if (last[0] && now - last[0].t < MARKET_MIN_INTERVAL_MS) return { ok: false, reason: "Updated less than five minutes ago." };
  let html: string;
  try {
    const res = await fetchImpl(IEX_DAM_URL, { headers: { "user-agent": "EnergyOS market price reader", accept: "text/html" }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    if (!res.ok) return { ok: false, reason: `IEX answered HTTP ${res.status}.` };
    html = await res.text();
  } catch (e) {
    return { ok: false, reason: `Could not reach IEX (${(e as Error).name === "TimeoutError" ? "timed out" : "network error"}).` };
  }
  const day = parseIexDamSnapshot(html);
  if (!day) return { ok: false, reason: "The IEX page did not contain a complete day of 96 blocks; stored prices were kept." };
  await storeMarketDay(db, day, now);
  return { ok: true, date: day.date, blocks: day.blocks.length };
}

export async function storeMarketDay(db: DB, day: MarketDay, fetchedAt: number) {
  await db.transaction(async (tx) => {
    await tx.delete(marketPrices).where(and(eq(marketPrices.source, IEX_SOURCE), eq(marketPrices.deliveryDate, day.date)));
    await tx.insert(marketPrices).values(day.blocks.map((b) => ({ source: IEX_SOURCE, deliveryDate: day.date, ...b, fetchedAt })));
  });
}

/** The most recent stored delivery day, with when it was fetched; null before the first successful fetch. */
export async function latestMarketDay(db: DB): Promise<(MarketDay & { fetchedAt: number }) | null> {
  const top = await db.select({ d: marketPrices.deliveryDate }).from(marketPrices).where(eq(marketPrices.source, IEX_SOURCE)).orderBy(desc(marketPrices.deliveryDate)).limit(1);
  if (!top[0]) return null;
  const rows = await db
    .select()
    .from(marketPrices)
    .where(and(eq(marketPrices.source, IEX_SOURCE), eq(marketPrices.deliveryDate, top[0].d)))
    .orderBy(marketPrices.block);
  if (rows.length !== 96) return null;
  return {
    date: top[0].d,
    fetchedAt: Math.max(...rows.map((r) => r.fetchedAt)),
    blocks: rows.map((r) => ({ block: r.block, startMin: r.startMin, mcpRsPerMwh: r.mcpRsPerMwh, mcvMw: r.mcvMw, purchaseBidMw: r.purchaseBidMw, sellBidMw: r.sellBidMw })),
  };
}
