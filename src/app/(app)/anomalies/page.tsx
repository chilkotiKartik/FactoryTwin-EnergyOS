import type { Metadata } from "next";
import Link from "next/link";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { ShieldCheck } from "lucide-react";
import { getDb } from "@/db/client";
import { anomalies, heats } from "@/db/schema";
import { requireActor } from "@/server/auth/session-next";
import { can } from "@/server/permissions";
import { requirePerm } from "@/server/context";
import { latestModel, requireFurnace } from "@/server/services/common";
import { secDrift } from "@/server/services/drift";
import { ANOMALY_RULE_TEXT } from "@/domain/anomaly";
import { PageHeader } from "@/components/ui/page-header";
import { Panel, PanelBody } from "@/components/ui/panel";
import { Badge, Evidence } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty";
import { Table, Td, Th } from "@/components/ui/table";
import { RunAnalysisButton } from "@/components/anomalies/run-analysis";
import { AnomalyStatus } from "@/components/heats/anomaly-status";
import { fmt, pct } from "@/lib/format";

export const metadata: Metadata = { title: "Anomalies" };

const STATUSES = ["OPEN", "ACKNOWLEDGED", "RESOLVED"] as const;
const LEVEL_TONE = { CONFIRMED: "red", STRONG: "amber", HYPOTHESIS: "blue", INSUFFICIENT: "neutral" } as const;

export default async function AnomaliesPage(props: PageProps<"/anomalies">) {
  const sp = await props.searchParams;
  const actor = await requireActor();
  requirePerm(actor, "view");
  const db = getDb();
  const status = typeof sp.status === "string" && (STATUSES as readonly string[]).includes(sp.status) ? (sp.status as (typeof STATUSES)[number]) : null;
  const rows = await db
    .select({ a: anomalies, h: heats })
    .from(anomalies)
    .innerJoin(heats, eq(heats.id, anomalies.heatId))
    .where(and(eq(anomalies.factoryId, actor.factory.id), isNotNull(anomalies.severity), status ? eq(anomalies.status, status) : undefined))
    .orderBy(desc(heats.dayDate), desc(anomalies.variancePct))
    .limit(200);
  const furnace = await requireFurnace(db, actor.factory.id);
  const [{ model }, drift] = await Promise.all([latestModel(db, actor.factory.id, furnace, actor.factory), secDrift(db, actor)]);
  const canEdit = can(actor.role, "analysis.run");

  return (
    <>
      <PageHeader
        title="Anomalies"
        crumbs={[{ label: actor.factory.name }, { label: "Anomalies" }]}
        description="Heats that used more energy than the expected-energy model predicts, with the evidence behind each flag. A flag starts an investigation; it is not a verdict."
        actions={can(actor.role, "analysis.run") ? <RunAnalysisButton /> : null}
      />
      <Panel className="mb-4">
        <PanelBody className="grid gap-3 text-[13px] md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div>
            <p className="font-semibold">Detection rule</p>
            <p className="text-ink-2">{ANOMALY_RULE_TEXT}</p>
          </div>
          <div>
            <p className="font-semibold">Model in use</p>
            <p className="text-ink-2">
              {model.version} · {model.kind === "OLS" ? `robust fit on ${model.n} clean heats, R² ${fmt(model.r2, 3)}, residual scale ${fmt(model.rmseKwh, 1)} kWh` : "physics prior (not enough clean history to fit)"}
            </p>
          </div>
          <div className="md:col-span-2">
            <p className="flex items-center gap-2 font-semibold">
              Gradual drift (CUSUM on daily residuals)
              <Badge tone={drift.status === "DRIFT_UP" ? "red" : drift.status === "DRIFT_DOWN" ? "amber" : drift.status === "STABLE" ? "teal" : "neutral"}>
                {drift.status === "DRIFT_UP" ? "rising" : drift.status === "DRIFT_DOWN" ? "falling" : drift.status === "STABLE" ? "stable" : "not enough data"}
              </Badge>
            </p>
            <p className="text-ink-2">{drift.message}</p>
          </div>
        </PanelBody>
      </Panel>
      <div className="mb-3 flex flex-wrap gap-1 text-[12px]">
        {[null, ...STATUSES].map((s) => (
          <Link key={s ?? "all"} href={s ? `/anomalies?status=${s}` : "/anomalies"} className={`rounded-md border px-2.5 py-1 ${status === s ? "border-ink bg-ink text-white" : "border-line bg-surface hover:bg-surface-3"}`}>
            {s ? s.charAt(0) + s.slice(1).toLowerCase() : "All"}
          </Link>
        ))}
      </div>
      <Panel>
        {rows.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="No flagged heats">
            No heat exceeds its expected energy by more than the threshold{status ? ` with status ${status.toLowerCase()}` : ""}.
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Heat</Th>
                <Th>Severity</Th>
                <Th>Evidence</Th>
                <Th align="right">Actual</Th>
                <Th align="right">Expected</Th>
                <Th align="right">Excess</Th>
                <Th>Explanation</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ a, h }) => (
                <tr key={a.id} className="align-top">
                  <Td>
                    <Link href={`/heats/${h.id}`} className="font-medium text-blue hover:underline">
                      {h.heatNo}
                    </Link>
                    <div className="text-[12px] text-ink-3">{h.dayDate}</div>
                    <Evidence label={a.provenance} className="mt-1" />
                  </Td>
                  <Td>
                    <Badge tone={a.severity === "HIGH" ? "red" : "amber"}>{a.severity}</Badge>
                  </Td>
                  <Td>
                    <Badge tone={LEVEL_TONE[a.evidenceLevel]}>{a.evidenceLevel}</Badge>
                  </Td>
                  <Td align="right">{fmt(a.actualKwh, 1)} kWh</Td>
                  <Td align="right">{fmt(a.expectedKwh, 1)} kWh</Td>
                  <Td align="right" className="font-medium text-amber">
                    +{fmt(a.varianceKwh, 1)} ({pct(a.variancePct)})
                  </Td>
                  <Td className="min-w-[280px] max-w-[440px] whitespace-normal text-[13px] text-ink-2">{a.explanation}</Td>
                  <Td>{canEdit ? <AnomalyStatus id={a.id} status={a.status} /> : <Badge>{a.status}</Badge>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}
