import { getDb } from "@/db/client";
import { IEX_DAM_URL, summariseMarketDay } from "@/domain/iex";
import { apiError, json } from "@/server/api/v1";
import { latestMarketDay } from "@/server/services/market";

/** GET /api/v1/market — today's IEX Day-Ahead prices (public data; no key needed). */
export async function GET() {
  const day = await latestMarketDay(getDb());
  if (!day) return apiError(404, "No market prices stored yet. The server reads IEX every 30 minutes.");
  const s = summariseMarketDay(day, 4);
  return json(
    {
      source: { name: "Indian Energy Exchange, Day-Ahead Market (unconstrained MCP)", url: IEX_DAM_URL },
      deliveryDate: day.date,
      fetchedAt: new Date(day.fetchedAt).toISOString(),
      unit: "INR/MWh",
      summary: { averageRsPerKwh: s.avgRsPerKwh, cheapest4h: s.cheapest, dearest4h: s.dearest },
      blocks: day.blocks.map((b) => ({ block: b.block, startMinute: b.startMin, mcp: b.mcpRsPerMwh, mcvMw: b.mcvMw })),
    },
    200,
    { "cache-control": "public, max-age=300" },
  );
}
