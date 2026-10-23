import type { Metadata } from "next";
import Link from "next/link";
import { Download, Gauge } from "lucide-react";
import { getDb } from "@/db/client";
import { requireActor } from "@/server/auth/session-next";
import { selectedDay } from "@/server/day";
import { can } from "@/server/permissions";
import { dataMode, dayTrace, rangeSummary } from "@/server/services/analytics";
import { listImports, listMeters, readingsPage } from "@/server/services/meters";
import { dayBounds } from "@/server/services/execution";
import { PageHeader } from "@/components/ui/page-header";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { Stat } from "@/components/ui/stat";
import { Badge, Evidence } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, Td, Th } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty";
import { EnergyTimeline } from "@/components/charts/energy-timeline";
import { CsvImport } from "@/components/meters/csv-import";
import { dayLabel, fmt, localTime, pct } from "@/lib/format";

export const metadata: Metadata = { title: "Meter data" };

export default async function MetersPage(props: PageProps<"/meters">) {
  const sp = await props.searchParams;
  const actor = await requireActor();
  const db = getDb();
  const tz = actor.factory.timeZone;
  const { day } = await selectedDay(actor, sp.day);
  const page = Math.max(1, Number(typeof sp.page === "string" ? sp.page : 1) || 1);
  const quality = typeof sp.quality === "string" ? sp.quality : undefined;
  const [meters, imports, mode] = await Promise.all([listMeters(db, actor), listImports(db, actor), dataMode(db, actor)]);
  const [sum, trace, readings] = day
    ? await Promise.all([rangeSummary(db, actor, day, day), dayTrace(db, actor, day), readingsPage(db, actor, { ...dayBounds(day, tz), page, pageSize: 60, quality })])
    : [null, null, null];
  const canImport = can(actor.role, "meter.import");
  const pages = readings ? Math.max(1, Math.ceil(readings.total / 60)) : 1;
  const qs = (o: Record<string, string | number | undefined>) => {
    const u = new URLSearchParams();
    if (day) u.set("day", day);
    for (const [k, v] of Object.entries({ quality, page, ...o })) if (v !== undefined && v !== "") u.set(k, String(v));
    return `/meters?${u.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Meter data"
        crumbs={[{ label: actor.factory.name }, { label: "Meter data" }]}
        description="Furnace energy readings: quality, gaps, energy not linked to a heat, and imports. Rejected or duplicate rows are never stored."
        actions={
          day && can(actor.role, "export") ? (
            <Button asChild variant="secondary" size="sm">
              <a href={`/api/export/readings?from=${day}&to=${day}`}>
                <Download /> Export readings CSV
              </a>
            </Button>
          ) : null
        }
      />

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        {meters.map((m) => (
          <Panel key={m.id}>
            <PanelBody className="flex flex-col gap-1 text-[13px]">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{m.name}</span>
                <Badge tone={mode.mode === "LIVE" ? "teal" : mode.mode === "SIMULATION" ? "violet" : "neutral"}>{mode.mode}</Badge>
              </div>
              <span className="text-ink-3">
                {m.model || "Meter"} · {m.intervalSeconds}s interval · ingest {m.ingestTokenHash ? "token issued" : "not connected"}
              </span>
              <span className="text-ink-3">Last reading: {localTime(mode.lastReadingAt, tz, true)}</span>
              <span className="text-[12px] text-ink-3">{mode.detail}</span>
            </PanelBody>
          </Panel>
        ))}
      </div>

      {!sum || !trace ? (
        <Panel className="mb-4">
          <EmptyState icon={Gauge} title="No readings yet">
            Import a CSV below or connect a meter with an ingest token from Factory settings.
          </EmptyState>
        </Panel>
      ) : (
        <>
          <Panel className="mb-4">
            <PanelHeader title={`Data quality · ${dayLabel(day!)}`} actions={<Evidence label={sum.evidence} />} />
            <div className="grid grid-cols-2 divide-line sm:grid-cols-3 lg:grid-cols-6 lg:divide-x">
              <Stat label="Readings" value={fmt(sum.readingCount)} definition="Stored meter readings for the day (1440 expected at 60 s)." />
              <Stat
                label="Completeness (operating)"
                value={pct(sum.completenessOperating === null ? null : sum.completenessOperating * 100, 1, false)}
                definition="Readings received ÷ readings expected between the first heat start and last tap."
                emphasis={sum.completenessOperating !== null && sum.completenessOperating < actor.factory.minCompleteness ? "amber" : null}
              />
              <Stat label="Gaps" value={fmt(sum.gaps.length)} definition="Runs of one or more missing intervals in the day." emphasis={sum.gaps.length ? "amber" : null} />
              <Stat label="Suspect / invalid" value={`${fmt(sum.suspectReadings)} / ${fmt(sum.invalidReadings)}`} definition="Suspect: above 125% of rated power or power/energy mismatch over 15%. Invalid: negative or physically impossible; excluded from totals." />
              <Stat label="Linked to heats" value={fmt(sum.linkedKwh, 0)} unit="kWh" definition="Energy in intervals between a heat's start and tap." />
              <Stat label="Unlinked energy" value={fmt(sum.unlinkedKwh, 0)} unit="kWh" definition="Energy above 5 kW idle outside any heat. Shown separately, never assigned to a heat." emphasis={sum.unlinkedKwh > 5 ? "amber" : null} />
            </div>
            <PanelBody className="border-t border-line">
              <EnergyTimeline points={trace.points} heats={trace.heats} tariffBands={trace.tariffBands} ariaLabel={`Meter power on ${day}`} />
            </PanelBody>
          </Panel>

          <div className="mb-4 grid gap-4 lg:grid-cols-2">
            <Panel id="gaps">
              <PanelHeader title="Gaps" subtitle="Missing intervals. Energy during a gap is unknown, not zero." />
              <PanelBody>
                {sum.gaps.length === 0 ? (
                  <p className="text-[13px] text-ink-3">No gaps on this day.</p>
                ) : (
                  <ul className="flex flex-col gap-1.5 text-[13px]">
                    {sum.gaps.map((g, i) => (
                      <li key={i} className="flex justify-between gap-3 rounded-md bg-amber-soft px-3 py-1.5">
                        <span className="num">
                          {localTime(g.from, tz)}–{localTime(g.to, tz)}
                        </span>
                        <span className="text-amber">{g.missingIntervals} intervals missing</span>
                      </li>
                    ))}
                  </ul>
                )}
              </PanelBody>
            </Panel>
            <Panel id="unlinked">
              <PanelHeader title="Energy not linked to a heat" subtitle="Furnace load outside any logged heat: possible unlogged heat, idling, or a missing heat record." />
              <PanelBody>
                {sum.unlinkedSpans.length === 0 ? (
                  <p className="text-[13px] text-ink-3">All load on this day falls inside logged heats.</p>
                ) : (
                  <ul className="flex flex-col gap-1.5 text-[13px]">
                    {sum.unlinkedSpans.map((u, i) => (
                      <li key={i} className="flex justify-between gap-3 rounded-md bg-surface-2 px-3 py-1.5">
                        <span className="num">
                          {localTime(u.from, tz)}–{localTime(u.to, tz)}
                        </span>
                        <span className="num text-ink-2">
                          {fmt(u.kwh, 1)} kWh · peak {fmt(u.peakKw, 0)} kW
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </PanelBody>
            </Panel>
          </div>
        </>
      )}

      {canImport ? (
        <Panel className="mb-4">
          <PanelHeader
            title="Import meter CSV"
            subtitle={
              <>
                Preview first, then commit. Try the{" "}
                <a className="text-blue hover:underline" href="/samples/meter-sample-with-errors.csv" download>
                  sample file with deliberate errors
                </a>
                .
              </>
            }
          />
          <PanelBody>
            <CsvImport meters={meters.map((m) => ({ id: m.id, name: m.name, intervalSeconds: m.intervalSeconds }))} isSimulation={actor.factory.isSimulation} tz={tz} />
          </PanelBody>
        </Panel>
      ) : null}

      <Panel className="mb-4">
        <PanelHeader title="Import history" />
        {imports.length === 0 ? (
          <PanelBody className="text-[13px] text-ink-3">No files imported yet. Scenario data is written directly by the scenario engine.</PanelBody>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>File</Th>
                <Th>Source label</Th>
                <Th align="right">Rows</Th>
                <Th align="right">Accepted</Th>
                <Th align="right">Rejected</Th>
                <Th align="right">Duplicates</Th>
                <Th>When</Th>
              </tr>
            </thead>
            <tbody>
              {imports.map(({ b, by }) => (
                <tr key={b.id}>
                  <Td className="font-medium">{b.filename}</Td>
                  <Td>
                    <Evidence label={b.provenance} />
                  </Td>
                  <Td align="right">{fmt(b.rowsTotal)}</Td>
                  <Td align="right">{fmt(b.rowsAccepted)}</Td>
                  <Td align="right">{fmt(b.rowsRejected)}</Td>
                  <Td align="right">{fmt(b.rowsDuplicate)}</Td>
                  <Td className="text-ink-2">
                    {localTime(b.createdAt, tz, true)} · {by ?? "—"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      {readings ? (
        <Panel>
          <PanelHeader
            title="Readings"
            subtitle={`${fmt(readings.total)} readings${quality ? ` with quality ${quality}` : ""} on ${day}`}
            actions={
              <div className="flex gap-1 text-[12px]">
                {["", "OK", "SUSPECT", "INVALID"].map((q) => (
                  <Link key={q} href={qs({ quality: q || undefined, page: 1 })} className={`rounded-md border px-2 py-1 ${(quality ?? "") === q ? "border-ink bg-ink text-white" : "border-line hover:bg-surface-3"}`}>
                    {q || "All"}
                  </Link>
                ))}
              </div>
            }
          />
          <div className="max-h-[480px] overflow-auto">
            <Table>
              <thead>
                <tr>
                  <Th>Time</Th>
                  <Th align="right">kW</Th>
                  <Th align="right">kWh</Th>
                  <Th>Quality</Th>
                  <Th>Source</Th>
                </tr>
              </thead>
              <tbody>
                {readings.rows.map((r) => (
                  <tr key={r.id}>
                    <Td className="num">{localTime(r.ts, tz)}</Td>
                    <Td align="right">{fmt(r.powerKw, 1)}</Td>
                    <Td align="right">{fmt(r.energyKwh, 3)}</Td>
                    <Td>
                      <Badge tone={r.quality === "OK" ? "neutral" : r.quality === "SUSPECT" ? "amber" : "red"} title={r.qualityNote ?? undefined}>
                        {r.quality}
                      </Badge>
                    </Td>
                    <Td>
                      <Evidence label={r.provenance} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          <div className="flex items-center justify-between border-t border-line px-4 py-2 text-[13px]">
            <span className="text-ink-3">
              Page {page} of {pages}
            </span>
            <div className="flex gap-2">
              {page > 1 ? (
                <Link className="text-blue hover:underline" href={qs({ page: page - 1 })}>
                  ← Previous
                </Link>
              ) : null}
              {page < pages ? (
                <Link className="text-blue hover:underline" href={qs({ page: page + 1 })}>
                  Next →
                </Link>
              ) : null}
            </div>
          </div>
        </Panel>
      ) : null}
    </>
  );
}
