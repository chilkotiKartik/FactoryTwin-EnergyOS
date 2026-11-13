import { and, asc, eq, gte, lte } from "drizzle-orm";
import { getDb } from "@/db/client";
import { heats } from "@/db/schema";
import { addDays, isIsoDate } from "@/domain/time";
import { withApiKey } from "@/server/api/v1";
import { validation } from "@/server/errors";

/** GET /api/v1/heats?from=YYYY-MM-DD&to=YYYY-MM-DD — heat records with metered and expected energy (max 31 days). */
export async function GET(req: Request) {
  return withApiKey(req, async (actor) => {
    const u = new URL(req.url);
    const to = u.searchParams.get("to") ?? "";
    const from = u.searchParams.get("from") ?? to;
    if (!isIsoDate(from) || !isIsoDate(to) || from > to) throw validation("Give from and to as YYYY-MM-DD, from ≤ to.");
    if (addDays(from, 30) < to) throw validation("At most 31 days per request.");
    const rows = await getDb()
      .select()
      .from(heats)
      .where(and(eq(heats.factoryId, actor.factory.id), gte(heats.dayDate, from), lte(heats.dayDate, to)))
      .orderBy(asc(heats.startAt))
      .limit(5000);
    return {
      period: { from, to },
      count: rows.length,
      heats: rows.map((h) => ({
        id: h.id,
        heatNo: h.heatNo,
        day: h.dayDate,
        grade: h.grade,
        order: h.orderCode,
        startAt: new Date(h.startAt).toISOString(),
        tapAt: h.tapAt === null ? null : new Date(h.tapAt).toISOString(),
        chargeKg: h.chargeKg,
        pouredKg: h.pouredKg,
        meterKwh: h.meterKwh,
        expectedKwh: h.expectedKwh,
        holdingMinutes: h.holdingMinutes,
        coldStart: h.coldStart,
        dataQuality: h.dataQuality,
        provenance: h.provenance,
      })),
    };
  });
}
