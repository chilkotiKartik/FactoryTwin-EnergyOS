/**
 * Indian Energy Exchange (IEX) Day-Ahead Market prices.
 *
 * IEX publishes the market clearing price (MCP, ₹/MWh) for each of the 96
 * fifteen-minute blocks of a delivery day on its public "market snapshot" page.
 * The page embeds the rows as JSON inside its server-rendered payload. This
 * parser is deliberately strict: it accepts a day only if all 96 blocks are
 * present, unique, numeric and plausible, so a layout change upstream yields
 * "no data" rather than wrong data.
 */
export const IEX_DAM_URL = "https://www.iexindia.com/market-data/day-ahead-market/market-snapshot";
export const IEX_SOURCE = "IEX_DAM";
/** Upper sanity bound, ₹/MWh. The DAM price ceiling has been ₹10,000/MWh; allow headroom for rule changes. */
const MAX_MCP = 50_000;

export interface MarketBlock {
  /** 1–96. */
  block: number;
  /** Local minute of day the block starts (IST). */
  startMin: number;
  mcpRsPerMwh: number;
  mcvMw: number;
  purchaseBidMw: number;
  sellBidMw: number;
}

export interface MarketDay {
  /** Delivery date, YYYY-MM-DD (IST). */
  date: string;
  blocks: MarketBlock[];
}

const num = (v: unknown): number | null => {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** Parse the snapshot page; returns the latest complete day, or null. */
export function parseIexDamSnapshot(html: string): MarketDay | null {
  const text = html.replace(/\\"/g, '"');
  const rows = text.match(/\{"date":"\d{2}-\d{2}-\d{4}","period":"[^"]{1,40}"[^{}]{0,600}\}/g) ?? [];
  const byDate = new Map<string, Map<number, MarketBlock>>();
  for (const raw of rows) {
    let r: Record<string, unknown>;
    try {
      r = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      continue;
    }
    const m = /^(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})$/.exec(String(r.period));
    const d = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(r.date));
    if (!m || !d) continue; // summary rows such as "Avg (MW)"
    const startMin = Number(m[1]) * 60 + Number(m[2]);
    const endMin = Number(m[3]) * 60 + Number(m[4]);
    const len = (endMin === 0 ? 1440 : endMin) - startMin;
    if (startMin % 15 !== 0 || len !== 15) continue;
    const mcp = num(r.mcp);
    const mcv = num(r.mcv);
    const pb = num(r.purchase_bid);
    const sb = num(r.sell_bid);
    if (mcp === null || mcp < 0 || mcp > MAX_MCP || mcv === null || mcv < 0 || pb === null || sb === null) continue;
    const iso = `${d[3]}-${d[2]}-${d[1]}`;
    const day = byDate.get(iso) ?? new Map<number, MarketBlock>();
    const block = startMin / 15 + 1;
    if (!day.has(block)) day.set(block, { block, startMin, mcpRsPerMwh: mcp, mcvMw: mcv, purchaseBidMw: pb, sellBidMw: sb });
    byDate.set(iso, day);
  }
  const complete = [...byDate.entries()].filter(([, b]) => b.size === 96).sort(([a], [b]) => b.localeCompare(a));
  if (!complete.length) return null;
  const [date, blocks] = complete[0];
  return { date, blocks: [...blocks.values()].sort((a, b) => a.block - b.block) };
}

export interface MarketSummary {
  avgRsPerKwh: number;
  min: { startMin: number; rsPerKwh: number };
  max: { startMin: number; rsPerKwh: number };
  /** Cheapest contiguous window of `hours` within the day. */
  cheapest: { startMin: number; endMin: number; avgRsPerKwh: number };
  /** Most expensive contiguous window of the same length. */
  dearest: { startMin: number; endMin: number; avgRsPerKwh: number };
}

/** Volume-unweighted day statistics in ₹/kWh, and the cheapest / dearest window of a given length. */
export function summariseMarketDay(day: MarketDay, hours = 4): MarketSummary {
  const p = day.blocks.map((b) => b.mcpRsPerMwh / 1000);
  const n = Math.max(1, Math.min(96, Math.round(hours * 4)));
  let minI = 0;
  let maxI = 0;
  p.forEach((v, i) => {
    if (v < p[minI]) minI = i;
    if (v > p[maxI]) maxI = i;
  });
  let sum = p.slice(0, n).reduce((s, v) => s + v, 0);
  let lo = { i: 0, s: sum };
  let hi = { i: 0, s: sum };
  for (let i = 1; i + n <= p.length; i++) {
    sum += p[i + n - 1] - p[i - 1];
    if (sum < lo.s - 1e-9) lo = { i, s: sum };
    if (sum > hi.s + 1e-9) hi = { i, s: sum };
  }
  const win = (w: { i: number; s: number }) => ({ startMin: day.blocks[w.i].startMin, endMin: day.blocks[w.i].startMin + n * 15, avgRsPerKwh: w.s / n });
  return {
    avgRsPerKwh: p.reduce((s, v) => s + v, 0) / p.length,
    min: { startMin: day.blocks[minI].startMin, rsPerKwh: p[minI] },
    max: { startMin: day.blocks[maxI].startMin, rsPerKwh: p[maxI] },
    cheapest: win(lo),
    dearest: win(hi),
  };
}
