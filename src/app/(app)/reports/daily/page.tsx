import type { Metadata } from "next";
import { requestNow } from "@/lib/clock";
import { getDb } from "@/db/client";
import { requireActor } from "@/server/auth/session-next";
import { rangeSummary } from "@/server/services/analytics";
import { isIsoDate } from "@/domain/time";
import { PageHeader } from "@/components/ui/page-header";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { Evidence } from "@/components/ui/badge";
import { Table, Td, Th } from "@/components/ui/table";
import { PrintButton } from "@/components/verification/actions";
import { dayLabel, fmt, inr, localTime, pct } from "@/lib/format";

export const metadata: Metadata = { title: "Daily energy report" };

export default async function DailyReport(props: PageProps<"/reports/daily">) {
  const sp = await props.searchParams;
  const actor = await requireActor();
  const day = typeof sp.day === "string" && isIsoDate(sp.day) ? sp.day : new Date(requestNow()).toISOString().slice(0, 10);
  const s = await rangeSummary(getDb(), actor, day, day);
  const tz = actor.factory.timeZone;
  const kv: [string, string][] = [
    ["Heats tapped", fmt(s.heatsTapped)],
    ["Tonnes poured", `${fmt(s.tonnesPoured, 2)} t`],
    ["Furnace energy (metered)", `${fmt(s.energyKwh, 1)} kWh`],
    ["Specific energy", `${fmt(s.sec, 1)} kWh/t`],
    ["Energy cost", inr(s.costPaise)],
    ["Cost per tonne", inr(s.costPerTonnePaise)],
    ["Holding at temperature", `${fmt(s.holdingMinutes)} min · ${fmt(s.holdingKwh, 0)} kWh`],
    ["Energy not linked to heats", `${fmt(s.unlinkedKwh, 1)} kWh`],
    ["Meter completeness (operating)", pct(s.completenessOperating === null ? null : s.completenessOperating * 100, 1, false)],
    ["Grid emissions", `${fmt(s.emissionsKg, 0)} kg CO₂ @ ${actor.factory.emissionFactor} kg/kWh`],
  ];
  return (
    <div className="print-full">
      <PageHeader
        title={`Daily energy report · ${dayLabel(day)}`}
        crumbs={[{ label: actor.factory.name }, { label: "Reports", href: "/reports" }, { label: day }]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Evidence label={s.evidence} /> {actor.factory.name} · generated {localTime(requestNow(), tz, true)} by {actor.name}
            {actor.factory.isSimulation ? " · SIMULATION — SYNTHETIC DATA — NOT FIELD VALIDATION" : ""}
          </span>
        }
        actions={<PrintButton />}
      />
      <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <Panel>
          <PanelHeader title="Summary" />
          <PanelBody className="flex flex-col gap-1.5 text-[13px]">
            {kv.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 border-b border-line pb-1">
                <span className="text-ink-3">{k}</span>
                <span className="num text-right">{v}</span>
              </div>
            ))}
            <p className="mt-2 text-[12px] text-ink-3">SEC = metered furnace kWh ÷ poured tonnes. Cost uses the tariff version in force at each reading. Holding is measured from the power trace.</p>
          </PanelBody>
        </Panel>
        <Panel>
          <PanelHeader title="Heats" />
          <Table>
            <thead>
              <tr>
                <Th>Heat</Th>
                <Th>Start</Th>
                <Th>Tap</Th>
                <Th align="right">Poured kg</Th>
                <Th align="right">kWh</Th>
                <Th align="right">Expected</Th>
                <Th align="right">SEC</Th>
                <Th align="right">Hold min</Th>
                <Th>Flag</Th>
              </tr>
            </thead>
            <tbody>
              {s.heats.map((h) => (
                <tr key={h.id}>
                  <Td className="font-medium">{h.heatNo}</Td>
                  <Td>{localTime(h.startAt, tz)}</Td>
                  <Td>{localTime(h.tapAt, tz)}</Td>
                  <Td align="right">{fmt(h.pouredKg)}</Td>
                  <Td align="right">{fmt(h.meterKwh, 1)}</Td>
                  <Td align="right">{fmt(h.expectedKwh, 1)}</Td>
                  <Td align="right">{fmt(h.secKwhPerT, 1)}</Td>
                  <Td align="right">{fmt(h.holdingMinutes)}</Td>
                  <Td className={h.anomalySeverity ? "font-semibold text-amber" : "text-ink-3"}>{h.anomalySeverity ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      </div>
    </div>
  );
}
