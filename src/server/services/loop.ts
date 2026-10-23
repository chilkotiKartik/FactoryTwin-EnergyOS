import { and, desc, eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { approvals, executionRecords, optimizationRuns, productionPlans, recommendations, users, verificationReports } from "@/db/schema";
import type { Actor } from "../context";
import type { RangeSummary } from "./analytics";

export type StageState = "done" | "attention" | "blocked" | "waiting";

export interface LoopStage {
  key: string;
  title: string;
  metric: string;
  detail: string;
  state: StageState;
  href: string;
  evidence?: string;
}

/** The seven-stage decision loop, every value read from persisted records. */
export async function decisionLoop(db: DB, actor: Actor, day: RangeSummary | null): Promise<LoopStage[]> {
  const f = actor.factory;
  const plan = await db.query.productionPlans.findFirst({ where: eq(productionPlans.factoryId, f.id), orderBy: desc(productionPlans.planDate) });
  const run = plan
    ? await db.query.optimizationRuns.findFirst({ where: eq(optimizationRuns.planId, plan.id), orderBy: desc(optimizationRuns.createdAt) })
    : null;
  const rec = plan
    ? await db.query.recommendations.findFirst({ where: eq(recommendations.planId, plan.id), orderBy: desc(recommendations.createdAt) })
    : null;
  const decision = rec
    ? (
        await db
          .select({ a: approvals, name: users.name })
          .from(approvals)
          .leftJoin(users, eq(users.id, approvals.actorId))
          .where(eq(approvals.recommendationId, rec.id))
          .limit(1)
      )[0]
    : undefined;
  const exec = plan ? await db.query.executionRecords.findFirst({ where: and(eq(executionRecords.planId, plan.id)), orderBy: desc(executionRecords.createdAt) }) : null;
  const report = await db.query.verificationReports.findFirst({ where: eq(verificationReports.factoryId, f.id), orderBy: desc(verificationReports.createdAt) });

  const stages: LoopStage[] = [];
  const comp = day?.completenessOperating ?? null;
  stages.push({
    key: "meter",
    title: "Meter readings",
    metric: day ? `${day.readingCount.toLocaleString("en-IN")} readings` : "No data",
    detail: comp === null ? "No production in the selected period." : `${(comp * 100).toFixed(1)}% complete while producing · ${day!.gaps.length} gap${day!.gaps.length === 1 ? "" : "s"}`,
    state: !day || comp === null ? "waiting" : comp < f.minCompleteness ? "attention" : "done",
    href: "/meters",
    evidence: day?.evidence,
  });
  const linkedPct = day && day.energyKwh > 0 ? (100 * day.linkedKwh) / day.energyKwh : null;
  stages.push({
    key: "link",
    title: "Heat association",
    metric: linkedPct === null ? "—" : `${linkedPct.toFixed(1)}% of kWh linked`,
    detail: day ? `${day.heatsTapped} heats · ${day.unlinkedKwh.toFixed(1)} kWh not linked to any heat` : "—",
    state: !day || linkedPct === null ? "waiting" : day.unlinkedSpans.length > 0 ? "attention" : "done",
    href: "/meters#unlinked",
  });
  const over = day?.heats.filter((h) => h.anomalySeverity) ?? [];
  const excess = over.reduce((s, h) => s + Math.max(0, h.varianceKwh ?? 0), 0);
  stages.push({
    key: "expected",
    title: "Expected vs actual",
    metric: day ? `${over.length} of ${day.heatsTapped} heats over` : "—",
    detail: day ? `${excess.toFixed(0)} kWh above expected on flagged heats` : "—",
    state: !day ? "waiting" : over.length ? "attention" : "done",
    href: "/heats",
  });
  const top = [...over].sort((a, b) => (b.variancePct ?? 0) - (a.variancePct ?? 0))[0];
  stages.push({
    key: "explain",
    title: "Anomaly explanation",
    metric: top ? `${top.heatNo}: ${top.variancePct! >= 0 ? "+" : ""}${top.variancePct!.toFixed(1)}%` : "Nothing to explain",
    detail: top ? `${Math.round(top.holdingMinutes ?? 0)} min holding · ${top.anomalySeverity?.toLowerCase()} severity` : "No heat above threshold.",
    state: top ? "attention" : day ? "done" : "waiting",
    href: top ? `/heats/${top.id}` : "/anomalies",
  });
  const runResult = run?.result as { recommended?: { totals: { costPaise: number } }; current?: { totals: { costPaise: number } } } | undefined;
  const runDelta =
    runResult?.recommended && runResult.current && runResult.current.totals.costPaise > 0
      ? (100 * (runResult.recommended.totals.costPaise - runResult.current.totals.costPaise)) / runResult.current.totals.costPaise
      : null;
  stages.push({
    key: "schedule",
    title: "Alternative schedule",
    metric: !run ? "Not run" : run.status === "OPTIMAL" ? (runDelta !== null ? `${runDelta.toFixed(1)}% cost (predicted)` : "Optimal") : run.status === "INFEASIBLE" ? "Infeasible" : "Paused",
    detail: !plan ? "No plan." : !run ? `Plan for ${plan.planDate} ready to optimise.` : run.status === "OPTIMAL" ? `Exact DP optimum for ${plan.planDate}` : run.status === "INFEASIBLE" ? "Blocking limits reported" : "Data completeness below minimum",
    state: !run ? "waiting" : run.status === "OPTIMAL" ? "done" : "blocked",
    href: "/optimizer",
    evidence: run?.status === "OPTIMAL" ? "MODELLED" : undefined,
  });
  stages.push({
    key: "decision",
    title: "Human decision",
    metric: !rec ? "Nothing to decide" : rec.status === "PENDING" ? "Awaiting supervisor" : rec.status.charAt(0) + rec.status.slice(1).toLowerCase(),
    detail: decision ? `${decision.name ?? "—"} (${decision.a.actorRole.toLowerCase()})${decision.a.reason ? ` — “${decision.a.reason}”` : ""}` : rec ? `Recommendation v${rec.version}` : "—",
    state: !rec ? "waiting" : rec.status === "PENDING" ? "attention" : rec.status === "APPROVED" || rec.status === "REJECTED" ? "done" : "blocked",
    href: rec ? `/recommendations/${rec.id}` : "/recommendations",
  });
  const m = report?.metrics as { savings?: { secChangePercent?: number | null; costPerTonneChangePercent?: number | null } } | undefined;
  stages.push({
    key: "verify",
    title: "Verification",
    metric: report && m?.savings ? `${(m.savings.secChangePercent ?? 0).toFixed(1)}% kWh/t` : exec ? "Outcome recorded" : "No outcome yet",
    detail: report ? `${report.baselineDay} vs ${report.comparisonDay} · ${(m?.savings?.costPerTonneChangePercent ?? 0).toFixed(1)}% ₹/t` : exec ? `Outcome for ${exec.dayDate} ready to verify` : "Record an outcome after a decision.",
    state: report ? "done" : exec ? "attention" : "waiting",
    href: report ? `/verification/${report.id}` : "/verification",
    evidence: report?.evidenceLabel,
  });
  return stages;
}
