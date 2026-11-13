import { withApiKey } from "@/server/api/v1";
import { getDb } from "@/db/client";
import { listRecommendations } from "@/server/services/recommendations";

/** GET /api/v1/recommendations — schedule recommendations, their predicted effect and the decision taken. */
export async function GET(req: Request) {
  return withApiKey(req, async (actor) => {
    const rows = await listRecommendations(getDb(), actor);
    return {
      count: rows.length,
      recommendations: rows.map((r) => ({
        id: r.id,
        planDate: r.planDate,
        version: r.version,
        status: r.status,
        summary: r.summary,
        predicted: r.predicted,
        createdAt: new Date(r.createdAt).toISOString(),
        decision: r.decision
          ? { decision: r.decision.a.decision, by: r.decision.name, role: r.decision.a.actorRole, reason: r.decision.a.reason, at: new Date(r.decision.a.decidedAt).toISOString() }
          : null,
      })),
    };
  });
}
