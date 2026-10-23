import type { Metadata } from "next";
import Link from "next/link";
import { and, eq, sql } from "drizzle-orm";
import { AlertTriangle, CalendarClock, PauseCircle, ShieldCheck } from "lucide-react";
import { getDb } from "@/db/client";
import { plannedHeats, recommendations } from "@/db/schema";
import { requireActor } from "@/server/auth/session-next";
import { can } from "@/server/permissions";
import { getPlan, listPlans } from "@/server/services/plans";
import { buildInput, latestRun, listRuns } from "@/server/services/optimization";
import { tariffBands } from "@/server/services/analytics";
import { primaryFurnace } from "@/server/services/common";
import { requestNow } from "@/lib/clock";
import type { OptimizerResult } from "@/domain/optimizer";
import { addDays } from "@/domain/time";
import { PageHeader } from "@/components/ui/page-header";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { Badge, Evidence } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty";
import { Table, Td, Th } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { PlanEditor } from "@/components/optimizer/plan-editor";
import { RunOptimizerButton } from "@/components/optimizer/run-button";
import { CreatePlanForm } from "@/components/optimizer/create-plan";
import { ChecksList, PredictedTable, ScheduleCompare, ScheduleTable, type Predicted } from "@/components/optimizer/schedule-views";
import { dayLabel, fmt, hhmm, localTime } from "@/lib/format";

export const metadata: Metadata = { title: "Schedule optimiser" };

export default async function OptimizerPage(props: PageProps<"/optimizer">) {
  const sp = await props.searchParams;
  const actor = await requireActor();
  const db = getDb();
  const tz = actor.factory.timeZone;
  const plans = await listPlans(db, actor);
  const detail = await getPlan(db, actor, typeof sp.plan === "string" ? sp.plan : null);
  const canPlan = can(actor.role, "plan.write");
  const canRun = can(actor.role, "optimizer.run");

  if (!detail) {
    const furnace = await primaryFurnace(db, actor.factory.id);
    return (
      <>
        <PageHeader title="Schedule optimiser" crumbs={[{ label: actor.factory.name }, { label: "Optimiser" }]} />
        <Panel>
          <EmptyState icon={CalendarClock} title="No production plan yet">
            The optimiser needs a plan: the heats to melt, their mould-ready times, orders and the dispatch deadline.
          </EmptyState>
          {canPlan && !actor.factory.isSimulation ? (
            <PanelBody className="border-t border-line">
              <CreatePlanForm defaultDate={addDays(new Date(requestNow()).toISOString().slice(0, 10), 1)} capacityKg={furnace?.capacityKg ?? 500} />
            </PanelBody>
          ) : null}
        </Panel>
      </>
    );
  }

  const { plan, orders, heats } = detail;
  const [run, runs, bandsRes, pendingRec, heatCounts] = await Promise.all([
    latestRun(db, actor, plan.id),
    listRuns(db, actor, plan.id),
    tariffBands(db, actor, plan.planDate),
    db.query.recommendations.findFirst({ where: and(eq(recommendations.planId, plan.id), eq(recommendations.status, "PENDING")) }),
    db.select({ orderId: plannedHeats.orderId, n: sql<number>`count(*)`, kg: sql<number>`sum(${plannedHeats.pouredKg})` }).from(plannedHeats).where(eq(plannedHeats.planId, plan.id)).groupBy(plannedHeats.orderId),
  ]);
  let currentHash: string | null = null;
  let inputError: string | null = null;
  try {
    currentHash = (await buildInput(db, actor, plan.id)).hash;
  } catch (e) {
    inputError = (e as Error).message;
  }
  const stale = run && currentHash ? run.inputHash !== currentHash : false;
  const result = run && run.status !== "PAUSED_DATA_QUALITY" ? (run.result as unknown as OptimizerResult & { dataQuality?: unknown }) : null;
  const paused = run?.status === "PAUSED_DATA_QUALITY" ? (run.result as { message: string }) : null;
  const latestRecForRun = run ? await db.query.recommendations.findFirst({ where: eq(recommendations.optimizationRunId, run.id) }) : null;
  const snapshot = run?.inputSnapshot as { tariff?: { name: string; version: number }; model?: { version: string; n: number } } | undefined;

  return (
    <>
      <PageHeader
        title="Schedule optimiser"
        crumbs={[{ label: actor.factory.name }, { label: "Optimiser" }]}
        description="Finds the lowest-cost start times for the planned heats without changing production, the heat sequence, or any safety and mould constraint. It proposes; a supervisor decides."
        actions={
          plans.length > 1 ? (
            <div className="flex flex-wrap gap-1">
              {plans.slice(0, 6).map((p) => (
                <Link key={p.id} href={`/optimizer?plan=${p.id}`} className={`rounded-md border px-2.5 py-1 text-[12px] ${p.id === plan.id ? "border-ink bg-ink text-white" : "border-line bg-surface text-ink-2 hover:bg-surface-3"}`}>
                  {p.planDate}
                </Link>
              ))}
            </div>
          ) : null
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex min-w-0 flex-col gap-4">
          {/* Status strip */}
          <Panel>
            <PanelBody className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex min-w-0 flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[15px] font-semibold">Plan for {dayLabel(plan.planDate)}</span>
                  <Badge>rev {plan.revision}</Badge>
                  <Evidence label={plan.provenance === "SIMULATED" ? "SIMULATED" : "MANUAL"} />
                  {!run ? <Badge>not yet optimised</Badge> : null}
                  {run && stale ? <Badge tone="amber">inputs changed since last run</Badge> : null}
                  {run?.status === "OPTIMAL" && !stale ? <Badge tone="teal">optimal for current inputs</Badge> : null}
                  {run?.status === "INFEASIBLE" ? <Badge tone="red">infeasible</Badge> : null}
                  {paused ? <Badge tone="amber">paused: data quality</Badge> : null}
                </div>
                <p className="text-[13px] text-ink-3">
                  {heats.length} heats · {fmt(heats.reduce((s, h) => s + h.pouredKg, 0) / 1000, 2)} t · deadline {hhmm(plan.deadlineMin)} · current practice starts {hhmm(plan.currentPracticeStartMin)}
                  {run ? <> · last run {localTime(run.createdAt, tz, true)}</> : null}
                </p>
                {inputError ? <p className="text-[13px] text-red">{inputError}</p> : null}
              </div>
              {canRun ? (
                <RunOptimizerButton planId={plan.id} disabled={!!inputError} />
              ) : (
                <p className="text-[12px] text-ink-3">Your role ({actor.role.toLowerCase()}) can view results but not run the optimiser.</p>
              )}
            </PanelBody>
          </Panel>

          {paused ? (
            <Panel className="border-amber/40">
              <PanelBody className="flex gap-3">
                <PauseCircle className="mt-0.5 size-5 shrink-0 text-amber" aria-hidden />
                <div>
                  <p className="font-semibold text-ink">Advice is paused</p>
                  <p className="mt-1 text-[14px] text-ink-2">{paused.message}</p>
                  <Link href="/meters#gaps" className="mt-2 inline-block text-[13px] font-medium text-blue hover:underline">
                    Open meter data quality →
                  </Link>
                </div>
              </PanelBody>
            </Panel>
          ) : null}

          {result ? (
            <Panel>
              <PanelHeader
                title={result.status === "OPTIMAL" ? "Current practice vs recommended schedule" : "Current practice vs earliest possible schedule"}
                subtitle="Bars show melting; hatched amber shows holding at temperature. Ticks mark mould readiness. Background bands are tariff windows."
              />
              <PanelBody>
                <ScheduleCompare
                  current={result.current.items}
                  recommended={result.recommended?.items ?? result.earliestPossible?.items ?? null}
                  recommendedLabel={result.recommended ? "Recommended" : "Earliest possible"}
                  bands={bandsRes.bands}
                  deadlineMin={plan.deadlineMin}
                  downtime={plan.downtime}
                />
              </PanelBody>
            </Panel>
          ) : null}

          {result?.status === "INFEASIBLE" ? (
            <Panel className="border-red/40">
              <PanelHeader title="No feasible schedule" subtitle="The optimiser did not relax any hard constraint. These are the constraints that block a solution." />
              <PanelBody>
                <ul className="flex flex-col gap-2">
                  {result.blocking.map((b, i) => (
                    <li key={i} className="flex gap-2 rounded-md border border-red/30 bg-red-soft px-3 py-2">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red" aria-hidden />
                      <div>
                        <p className="text-[13px] font-semibold text-ink">{b.constraint}</p>
                        <p className="text-[13px] text-ink-2">{b.detail}</p>
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-[13px] text-ink-3">To make a plan feasible: move the deadline, shorten or move downtime, bring mould readiness forward, or split production across days. Edit the inputs on the right and re-run.</p>
              </PanelBody>
            </Panel>
          ) : null}

          {result?.status === "OPTIMAL" && result.recommended ? (
            <>
              <Panel>
                <PanelHeader
                  title="Predicted effect"
                  subtitle={latestRecForRun ? `Recommendation v${latestRecForRun.version} · ${latestRecForRun.status.toLowerCase()}` : "No change recommended"}
                  actions={
                    latestRecForRun ? (
                      <Button asChild size="sm" variant={latestRecForRun.status === "PENDING" ? "amber" : "secondary"}>
                        <Link href={`/recommendations/${latestRecForRun.id}`}>{latestRecForRun.status === "PENDING" ? "Review & decide" : "Open recommendation"}</Link>
                      </Button>
                    ) : null
                  }
                />
                <PanelBody>
                  {latestRecForRun ? (
                    <PredictedTable p={latestRecForRun.predicted as unknown as Predicted} />
                  ) : (
                    <p className="text-[14px] text-ink-2">The best feasible schedule matches current practice within ₹1 and 1 kWh, so there is nothing to approve.</p>
                  )}
                </PanelBody>
              </Panel>
              <Panel>
                <PanelHeader title="Hard-constraint checks" subtitle="Re-checked independently on the final schedule, not just inside the solver." />
                <PanelBody>
                  <ChecksList checks={result.recommended.checks} />
                </PanelBody>
              </Panel>
              <Panel>
                <PanelHeader title="Heat-by-heat schedule" subtitle="Current practice → recommended. Sequence and charge are unchanged." />
                <ScheduleTable current={result.current.items} recommended={result.recommended.items} />
              </Panel>
            </>
          ) : null}

          {result ? (
            <Panel>
              <PanelHeader title="Solver" />
              <PanelBody className="grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2">
                <Meta k="Status" v={result.status} />
                <Meta k="Method" v={`${result.solver} v${result.solverVersion} (exact dynamic programme)`} />
                <Meta k="Runtime" v={`${fmt(result.runtimeMs, 1)} ms · ${fmt(result.statesExplored)} states`} />
                <Meta k="Input fingerprint" v={<code className="font-mono text-[12px]">{run!.inputHash.slice(0, 16)}</code>} />
                <Meta k="Tariff" v={snapshot?.tariff ? `${snapshot.tariff.name} (v${snapshot.tariff.version})` : "—"} />
                <Meta k="Energy model" v={snapshot?.model ? `${snapshot.model.version} · n=${snapshot.model.n}` : "—"} />
                <p className="text-ink-3 sm:col-span-2">{result.optimalityNote}</p>
                {result.warnings.map((w, i) => (
                  <p key={i} className="text-amber sm:col-span-2">
                    {w}
                  </p>
                ))}
              </PanelBody>
            </Panel>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Panel>
            <PanelHeader title="Plan inputs" subtitle="Hard constraints the optimiser must respect." />
            <PanelBody>
              <PlanEditor
                key={`${plan.id}-${plan.revision}`}
                planId={plan.id}
                revision={plan.revision}
                deadlineMin={plan.deadlineMin}
                startMin={plan.currentPracticeStartMin}
                downtime={plan.downtime}
                orders={orders.map((o) => {
                  const c = heatCounts.find((x) => x.orderId === o.id);
                  return { id: o.id, code: o.code, grade: o.grade, requiredTonnes: o.requiredTonnes, dueMin: o.dueMin, heats: Number(c?.n ?? 0), heatTonnes: Number(c?.kg ?? 0) / 1000 };
                })}
                mould={heats.filter((h) => h.mouldSet !== null).map((h) => ({ mouldSet: h.mouldSet!, heatNo: h.heatNo, readyMin: h.mouldReadyMin }))}
                canEdit={canPlan}
              />
            </PanelBody>
          </Panel>
          {pendingRec ? (
            <Panel className="border-amber/40">
              <PanelBody className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 size-5 shrink-0 text-amber" aria-hidden />
                <div className="text-[13px]">
                  <p className="font-semibold">Recommendation v{pendingRec.version} awaits a decision</p>
                  <p className="text-ink-3">{pendingRec.summary}</p>
                  <Link className="mt-1 inline-block font-medium text-blue hover:underline" href={`/recommendations/${pendingRec.id}`}>
                    Review →
                  </Link>
                </div>
              </PanelBody>
            </Panel>
          ) : null}
          <Panel>
            <PanelHeader title="Run history" />
            {runs.length === 0 ? (
              <PanelBody className="text-[13px] text-ink-3">No runs yet.</PanelBody>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>When</Th>
                    <Th>Status</Th>
                    <Th align="right">ms</Th>
                    <Th>Inputs</Th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id}>
                      <Td className="text-ink-2">{localTime(r.createdAt, tz, true)}</Td>
                      <Td>
                        <Badge tone={r.status === "OPTIMAL" ? "teal" : r.status === "INFEASIBLE" ? "red" : "amber"}>{r.status.replace(/_/g, " ").toLowerCase()}</Badge>
                      </Td>
                      <Td align="right">{fmt(r.runtimeMs, 0)}</Td>
                      <Td className="text-[12px]">{r.inputHash === currentHash ? <span className="text-teal">current</span> : <span className="text-ink-3">changed</span>}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

function Meta({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-line py-1">
      <span className="text-ink-3">{k}</span>
      <span className="num text-right text-ink">{v}</span>
    </div>
  );
}
