import type { Metadata } from "next";
import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { FileCheck2 } from "lucide-react";
import { getDb } from "@/db/client";
import { heats, recommendations } from "@/db/schema";
import { requireActor } from "@/server/auth/session-next";
import { can } from "@/server/permissions";
import { availableDays } from "@/server/services/analytics";
import { listExecutions } from "@/server/services/execution";
import { getPlan } from "@/server/services/plans";
import { activeSchedule } from "@/server/services/recommendations";
import { assumptionsSchema, computeVerification, DEFAULT_ASSUMPTIONS, listVerificationReports } from "@/server/services/verification";
import { PageHeader } from "@/components/ui/page-header";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { EmptyState } from "@/components/ui/empty";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { Evidence } from "@/components/ui/badge";
import { Table, Td, Th } from "@/components/ui/table";
import { VerificationView } from "@/components/verification/verification-view";
import { RecordOutcomeButton, SaveReportButton } from "@/components/verification/actions";
import { dayLabel, localTime } from "@/lib/format";

export const metadata: Metadata = { title: "Verification" };

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function VerificationPage(props: PageProps<"/verification">) {
  const sp = await props.searchParams;
  const actor = await requireActor();
  const db = getDb();
  const tz = actor.factory.timeZone;
  const [days, executions, reports, detail] = await Promise.all([availableDays(db, actor), listExecutions(db, actor), listVerificationReports(db, actor), getPlan(db, actor)]);

  // Outcome recording state for the latest plan.
  let outcome: { state: "ready" | "pending" | "none" | "recorded"; label: string } | null = null;
  if (detail && actor.factory.isSimulation) {
    const [active, pending, existing] = await Promise.all([
      activeSchedule(db, actor, detail.plan.id),
      db.query.recommendations.findFirst({ where: and(eq(recommendations.planId, detail.plan.id), eq(recommendations.status, "PENDING")) }),
      db.query.heats.findFirst({ where: and(eq(heats.factoryId, actor.factory.id), eq(heats.dayDate, detail.plan.planDate)) }),
    ]);
    if (existing) outcome = { state: "recorded", label: "" };
    else if (pending) outcome = { state: "pending", label: "" };
    else if (!active) outcome = { state: "none", label: "" };
    else outcome = { state: "ready", label: active.version.kind === "RECOMMENDED" ? "Run approved schedule (simulated)" : "Run current practice (simulated)" };
  }

  const execDays = new Set(executions.map((e) => e.dayDate));
  const latestExec = executions[0]?.dayDate;
  const comparison = str(sp.comparison) && days.includes(str(sp.comparison)!) ? str(sp.comparison)! : (latestExec ?? days[0]);
  const baseline = str(sp.baseline) && days.includes(str(sp.baseline)!) ? str(sp.baseline)! : (days.find((d) => d < (comparison ?? "") && !execDays.has(d)) ?? days[1]);
  const parsed = assumptionsSchema.safeParse({
    operatingDaysPerYear: Number(str(sp.days) ?? DEFAULT_ASSUMPTIONS.operatingDaysPerYear),
    realisationPct: Number(str(sp.real) ?? DEFAULT_ASSUMPTIONS.realisationPct),
    capexInr: Number(str(sp.capex) ?? DEFAULT_ASSUMPTIONS.capexInr),
    opexInrPerYear: Number(str(sp.opex) ?? DEFAULT_ASSUMPTIONS.opexInrPerYear),
  });
  const assumptions = parsed.success ? parsed.data : DEFAULT_ASSUMPTIONS;
  const v = baseline && comparison ? await computeVerification(db, actor, baseline, comparison, assumptions) : null;

  return (
    <>
      <PageHeader
        title="Savings verification"
        crumbs={[{ label: actor.factory.name }, { label: "Verification" }]}
        description="Compares a baseline day with a comparison day using metered energy, per tonne. Only recorded outcomes are called savings; predictions stay labelled as modelled."
      />

      {outcome ? (
        <Panel className="mb-4">
          <PanelBody className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-[14px]">
              <p className="font-semibold">Outcome for plan {detail ? dayLabel(detail.plan.planDate) : ""}</p>
              <p className="text-ink-3">
                {outcome.state === "recorded"
                  ? "An outcome has been recorded for this plan day. Compare it below."
                  : outcome.state === "pending"
                    ? "A recommendation is awaiting a decision. Approve or reject it first."
                    : outcome.state === "none"
                      ? "Run the optimiser first, then decide on its recommendation."
                      : "The scenario engine can execute the plan's active schedule and record a synthetic outcome (meter readings and heats, labelled SIMULATED)."}
              </p>
            </div>
            {outcome.state === "ready" && can(actor.role, "outcome.record") ? <RecordOutcomeButton planId={detail!.plan.id} label={outcome.label} /> : null}
            {outcome.state === "pending" ? (
              <Button asChild variant="amber">
                <Link href="/recommendations">Go to approvals</Link>
              </Button>
            ) : null}
          </PanelBody>
        </Panel>
      ) : null}

      {!v ? (
        <Panel>
          <EmptyState icon={FileCheck2} title="Two days of data are needed">
            Verification compares a baseline day with a comparison day. Log heats and import meter data for at least two days.
          </EmptyState>
        </Panel>
      ) : (
        <>
          <Panel className="mb-4">
            <PanelBody>
              <form className="grid items-end gap-3 sm:grid-cols-3 lg:grid-cols-7" method="get">
                <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-2 lg:col-span-1">
                  Baseline day
                  <Select name="baseline" defaultValue={baseline}>
                    {days.map((d) => (
                      <option key={d} value={d}>
                        {d}
                        {execDays.has(d) ? " (outcome)" : ""}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-2 lg:col-span-1">
                  Comparison day
                  <Select name="comparison" defaultValue={comparison}>
                    {days.map((d) => (
                      <option key={d} value={d}>
                        {d}
                        {execDays.has(d) ? " (outcome)" : ""}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-2">
                  Days / year
                  <Input name="days" inputMode="numeric" defaultValue={assumptions.operatingDaysPerYear} />
                </label>
                <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-2">
                  Realisation %
                  <Input name="real" inputMode="numeric" defaultValue={assumptions.realisationPct} />
                </label>
                <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-2">
                  Capex ₹
                  <Input name="capex" inputMode="numeric" defaultValue={assumptions.capexInr} />
                </label>
                <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-2">
                  Opex ₹/yr
                  <Input name="opex" inputMode="numeric" defaultValue={assumptions.opexInrPerYear} />
                </label>
                <Button type="submit" variant="secondary">
                  Recalculate
                </Button>
              </form>
              {!parsed.success ? <p className="mt-2 text-[13px] text-red">Some assumptions were out of range; defaults are shown instead.</p> : null}
              {baseline === comparison ? <p className="mt-2 text-[13px] text-amber">Baseline and comparison are the same day.</p> : null}
            </PanelBody>
          </Panel>
          <VerificationView v={v} tz={tz} />
          {can(actor.role, "verification.create") && baseline !== comparison ? (
            <div className="mt-4 flex justify-end">
              <SaveReportButton baselineDay={baseline!} comparisonDay={comparison!} assumptions={assumptions} />
            </div>
          ) : null}
        </>
      )}

      <Panel className="mt-6">
        <PanelHeader title="Saved verification reports" />
        {reports.length === 0 ? (
          <PanelBody className="text-[13px] text-ink-3">No reports saved yet.</PanelBody>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Report</Th>
                <Th>Evidence</Th>
                <Th>Created</Th>
                <Th>By</Th>
              </tr>
            </thead>
            <tbody>
              {reports.map(({ r, author }) => (
                <tr key={r.id}>
                  <Td>
                    <Link href={`/verification/${r.id}`} className="font-medium text-blue hover:underline">
                      {r.title}
                    </Link>
                  </Td>
                  <Td>
                    <Evidence label={r.evidenceLabel} />
                  </Td>
                  <Td className="text-ink-2">{localTime(r.createdAt, tz, true)}</Td>
                  <Td className="text-ink-2">{author ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}
