import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { getDb } from "@/db/client";
import { auditEvents, recommendations, users } from "@/db/schema";
import { requireActor } from "@/server/auth/session-next";
import { can, ROLE_LABEL } from "@/server/permissions";
import { getRecommendation } from "@/server/services/recommendations";
import { tariffBands } from "@/server/services/analytics";
import type { OptimizerResult } from "@/domain/optimizer";
import { PageHeader } from "@/components/ui/page-header";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Appear } from "@/components/ui/appear";
import { StatusBadge } from "@/components/recommendations/status-badge";
import { DecisionPanel } from "@/components/recommendations/decision-panel";
import { ChecksList, PredictedTable, ScheduleCompare, ScheduleTable, type Predicted } from "@/components/optimizer/schedule-views";
import { dayLabel, localTime } from "@/lib/format";

export const metadata: Metadata = { title: "Recommendation" };

export default async function RecommendationPage(props: PageProps<"/recommendations/[id]">) {
  const { id } = await props.params;
  const actor = await requireActor();
  const db = getDb();
  const d = await getRecommendation(db, actor, id);
  if (!d) notFound();
  const tz = actor.factory.timeZone;
  const { rec, plan, run, proposed, current, approval } = d;
  const p = rec.predicted as unknown as Predicted;
  const result = run.result as unknown as OptimizerResult;
  const snapshot = run.inputSnapshot as { tariff?: { name: string; version: number }; model?: { version: string; n: number } };
  const [bands, creator, siblings, events] = await Promise.all([
    tariffBands(db, actor, plan.planDate),
    rec.createdBy ? db.query.users.findFirst({ where: eq(users.id, rec.createdBy), columns: { name: true } }) : null,
    db.select().from(recommendations).where(and(eq(recommendations.planId, plan.id), eq(recommendations.factoryId, actor.factory.id))).orderBy(desc(recommendations.version)),
    db.select().from(auditEvents).where(and(eq(auditEvents.factoryId, actor.factory.id), eq(auditEvents.entityId, rec.id))).orderBy(desc(auditEvents.createdAt)),
  ]);
  const canDecide = can(actor.role, "recommendation.decide");

  return (
    <>
      <PageHeader
        title={`Schedule recommendation v${rec.version}`}
        crumbs={[{ label: actor.factory.name }, { label: "Approvals", href: "/recommendations" }, { label: `v${rec.version}` }]}
        description={`For ${dayLabel(plan.planDate)}. ${rec.summary}`}
        actions={<StatusBadge status={rec.status} />}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          {rec.status === "STALE" ? (
            <Panel className="border-amber/40">
              <PanelBody className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber" aria-hidden />
                <div className="text-[14px]">
                  <p className="font-semibold">This recommendation is stale</p>
                  <p className="text-ink-2">The plan, tariff or energy model changed after it was computed, so it can no longer be approved.</p>
                  <Link href={`/optimizer?plan=${plan.id}`} className="mt-1 inline-block font-medium text-blue hover:underline">
                    Re-run the optimiser →
                  </Link>
                </div>
              </PanelBody>
            </Panel>
          ) : null}
          <Panel>
            <PanelHeader title="Current practice vs proposed" subtitle="Same heats, same sequence, same tonnes. Only start times move." />
            <PanelBody>
              <ScheduleCompare current={current} recommended={proposed} recommendedLabel="Proposed" bands={bands.bands} deadlineMin={plan.deadlineMin} downtime={plan.downtime} />
            </PanelBody>
          </Panel>
          <Panel>
            <PanelHeader title="Predicted effect" />
            <PanelBody>
              <PredictedTable p={p} />
            </PanelBody>
          </Panel>
          {result.recommended ? (
            <Panel>
              <PanelHeader title="Hard-constraint checks" />
              <PanelBody>
                <ChecksList checks={result.recommended.checks} />
              </PanelBody>
            </Panel>
          ) : null}
          <Panel>
            <PanelHeader title="Heat-by-heat changes" />
            <ScheduleTable current={current} recommended={proposed} />
          </Panel>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Panel>
            <PanelHeader title="Decision" />
            <PanelBody>
              {rec.status === "PENDING" && canDecide ? (
                <DecisionPanel recommendationId={rec.id} version={rec.version} summary={rec.summary} />
              ) : approval ? (
                <Appear className="flex items-start gap-3 text-[14px]" data-testid="decision-record">
                  <ShieldCheck className={`mt-0.5 size-5 shrink-0 ${approval.a.decision === "APPROVED" ? "text-teal" : "text-red"}`} aria-hidden />
                  <div>
                    <p className="font-semibold">{approval.a.decision === "APPROVED" ? "Approved" : "Rejected"} by {approval.name ?? "unknown"}</p>
                    <p className="text-ink-3">
                      {ROLE_LABEL[approval.a.actorRole as keyof typeof ROLE_LABEL] ?? approval.a.actorRole} · {localTime(approval.a.decidedAt, tz, true)} · version {approval.a.recommendationVersion}
                    </p>
                    {approval.a.reason ? <p className="mt-2 rounded-md bg-surface-2 px-3 py-2 text-ink-2">“{approval.a.reason}”</p> : null}
                    {approval.a.decision === "APPROVED" ? (
                      <Button asChild size="sm" variant="secondary" className="mt-3">
                        <Link href="/verification">Record outcome & verify →</Link>
                      </Button>
                    ) : null}
                  </div>
                </Appear>
              ) : rec.status === "PENDING" ? (
                <p className="text-[14px] text-ink-2">Awaiting a supervisor or owner. Your role ({ROLE_LABEL[actor.role]}) cannot approve or reject.</p>
              ) : (
                <p className="text-[14px] text-ink-2">No decision was taken; this version is {rec.status.toLowerCase()}.</p>
              )}
            </PanelBody>
          </Panel>
          <Panel>
            <PanelHeader title="Provenance" />
            <PanelBody className="flex flex-col gap-1.5 text-[13px]">
              <Row k="Created" v={`${localTime(rec.createdAt, tz, true)}${creator ? ` by ${creator.name}` : ""}`} />
              <Row k="Plan inputs as of" v={localTime(rec.inputTimestamp, tz, true)} />
              <Row k="Plan revision" v={String(plan.revision)} />
              <Row k="Solver" v={`${run.solver} v${run.solverVersion} · ${run.runtimeMs.toFixed(1)} ms`} />
              <Row k="Energy model" v={snapshot.model ? `${snapshot.model.version} (n=${snapshot.model.n})` : run.modelVersion} />
              <Row k="Tariff" v={snapshot.tariff ? `${snapshot.tariff.name} v${snapshot.tariff.version}` : "—"} />
              <Row k="Input fingerprint" v={<code className="font-mono text-[12px]">{rec.inputHash.slice(0, 16)}</code>} />
              <Link href={`/optimizer?plan=${plan.id}`} className="mt-1 font-medium text-blue hover:underline">
                Open optimiser run →
              </Link>
            </PanelBody>
          </Panel>
          <Panel>
            <PanelHeader title="Versions for this plan" />
            <PanelBody className="flex flex-col gap-1.5 text-[13px]">
              {siblings.map((s) => (
                <Link key={s.id} href={`/recommendations/${s.id}`} className={`flex items-center justify-between gap-2 rounded px-2 py-1 ${s.id === rec.id ? "bg-surface-3" : "hover:bg-surface-2"}`}>
                  <span className="font-medium">v{s.version}</span>
                  <StatusBadge status={s.status} />
                </Link>
              ))}
            </PanelBody>
          </Panel>
          {can(actor.role, "audit.view") ? (
            <Panel>
              <PanelHeader title="History" />
              <PanelBody>
                <ol className="flex flex-col gap-2 text-[13px]">
                  {events.map((e) => (
                    <li key={e.id} className="border-l-2 border-line pl-3">
                      <p className="font-medium">{e.action}</p>
                      <p className="text-ink-3">
                        {e.actorName ?? "system"} · {localTime(e.createdAt, tz, true)}
                      </p>
                    </li>
                  ))}
                  {events.length === 0 ? <li className="text-ink-3">Created by optimiser run; no decision yet.</li> : null}
                </ol>
              </PanelBody>
            </Panel>
          ) : null}
        </div>
      </div>
    </>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-ink-3">{k}</span>
      <span className="num text-right">{v}</span>
    </div>
  );
}
