import { isIsoDate, addDays } from "@/domain/time";
import { withApiKey } from "@/server/api/v1";
import { getDb } from "@/db/client";
import { validation } from "@/server/errors";
import { rangeSummary } from "@/server/services/analytics";

/** GET /api/v1/summary?from=YYYY-MM-DD&to=YYYY-MM-DD — energy, tonnes, SEC, cost and quality for a period (max 31 days). */
export async function GET(req: Request) {
  return withApiKey(req, async (actor) => {
    const u = new URL(req.url);
    const to = u.searchParams.get("to") ?? "";
    const from = u.searchParams.get("from") ?? to;
    if (!isIsoDate(from) || !isIsoDate(to) || from > to) throw validation("Give from and to as YYYY-MM-DD, from ≤ to.");
    if (addDays(from, 30) < to) throw validation("At most 31 days per request.");
    const s = await rangeSummary(getDb(), actor, from, to);
    return {
      factory: { id: actor.factory.id, name: actor.factory.name, timeZone: actor.factory.timeZone, simulation: actor.factory.isSimulation },
      period: { from, to },
      evidence: s.evidence,
      energyKwh: s.energyKwh,
      tonnesPoured: s.tonnesPoured,
      secKwhPerTonne: s.sec,
      costInr: s.costPaise / 100,
      costPerTonneInr: s.costPerTonnePaise === null ? null : s.costPerTonnePaise / 100,
      costByWindow: Object.fromEntries(Object.entries(s.costByKind).map(([k, v]) => [k, { kwh: v.kwh, inr: v.paise / 100 }])),
      holdingMinutes: s.holdingMinutes,
      holdingKwh: s.holdingKwh,
      heats: { total: s.heatsCount, tapped: s.heatsTapped, flagged: s.heats.filter((h) => h.anomalySeverity).length },
      meterCompleteness: s.completenessOperating,
      emissionsKgCo2: s.emissionsKg,
    };
  });
}
