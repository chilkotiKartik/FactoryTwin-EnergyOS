import type { Metadata } from "next";
import Link from "next/link";
import { Download, Printer } from "lucide-react";
import { requireActor } from "@/server/auth/session-next";
import { selectedDay } from "@/server/day";
import { can } from "@/server/permissions";
import { addDays } from "@/domain/time";
import { PageHeader } from "@/components/ui/page-header";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";

export const metadata: Metadata = { title: "Reports & exports" };

const KINDS = [
  { kind: "heats", title: "Heat log", text: "Every heat with times, tonnes, meter and expected kWh, SEC, holding, data quality and provenance." },
  { kind: "readings", title: "Meter readings", text: "Interval readings with the tariff rate and cost per interval, quality flags and provenance." },
  { kind: "anomalies", title: "Anomalies", text: "Flagged heats with expected vs actual energy, threshold, evidence level and status." },
  { kind: "recommendations", title: "Recommendations & decisions", text: "Optimiser recommendations (modelled) with the decision, who took it, when and why." },
  { kind: "audit", title: "Audit log", text: "Every recorded action with actor, entity and details. Requires audit access." },
] as const;

export default async function ReportsPage() {
  const actor = await requireActor();
  const { day } = await selectedDay(actor, null);
  const to = day ?? new Date().toISOString().slice(0, 10);
  const from = addDays(to, -6);
  const canExport = can(actor.role, "export");
  return (
    <>
      <PageHeader
        title="Reports & exports"
        crumbs={[{ label: actor.factory.name }, { label: "Reports & exports" }]}
        description="CSV files carry a header block with factory, period, units, calculation notes and data mode, so they stay understandable outside the app. Up to 31 days per file."
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel>
          <PanelHeader title="CSV exports" />
          {!canExport ? (
            <PanelBody className="text-[13px] text-ink-3">Your role cannot export data.</PanelBody>
          ) : (
            <ul className="divide-y divide-line">
              {KINDS.filter((k) => k.kind !== "audit" || can(actor.role, "audit.view")).map((k) => (
                <li key={k.kind} className="px-4 py-3">
                  <form method="get" action={`/api/export/${k.kind}`} className="flex flex-wrap items-end gap-3">
                    <div className="min-w-[220px] flex-1">
                      <p className="text-[14px] font-semibold">{k.title}</p>
                      <p className="text-[13px] text-ink-3">{k.text}</p>
                    </div>
                    <label className="flex flex-col gap-1 text-[12px] text-ink-3">
                      From
                      <Input type="date" name="from" defaultValue={from} className="w-40" />
                    </label>
                    <label className="flex flex-col gap-1 text-[12px] text-ink-3">
                      To
                      <Input type="date" name="to" defaultValue={to} className="w-40" />
                    </label>
                    <Button type="submit" variant="secondary" data-testid={`export-${k.kind}`}>
                      <Download /> CSV
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <div className="flex flex-col gap-4">
          <Panel>
            <PanelHeader title="Printable reports" />
            <PanelBody className="flex flex-col gap-3 text-[13px]">
              <form method="get" action="/reports/daily" className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-[12px] text-ink-3">
                  Daily energy report
                  <Input type="date" name="day" defaultValue={to} className="w-40" />
                </label>
                <Button type="submit" variant="secondary">
                  <Printer /> Open
                </Button>
              </form>
              <p className="text-ink-3">
                Verification reports are printable from{" "}
                <Link className="text-blue hover:underline" href="/verification">
                  Verification
                </Link>
                .
              </p>
            </PanelBody>
          </Panel>
        </div>
      </div>
    </>
  );
}
