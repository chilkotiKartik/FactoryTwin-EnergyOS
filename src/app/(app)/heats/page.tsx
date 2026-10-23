import type { Metadata } from "next";
import { requestNow } from "@/lib/clock";
import Link from "next/link";
import { Flame, Search } from "lucide-react";
import { getDb } from "@/db/client";
import { requireActor } from "@/server/auth/session-next";
import { listHeats } from "@/server/services/heats";
import { requireFurnace } from "@/server/services/common";
import { selectedDay } from "@/server/day";
import { can } from "@/server/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { Table, Td, Th } from "@/components/ui/table";
import { Badge, Evidence } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty";
import { Input, Select } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { NewHeatButton } from "@/components/heats/new-heat-button";
import { fmt, localTime, pct } from "@/lib/format";
import { localDate, formatLocalTime } from "@/domain/time";

export const metadata: Metadata = { title: "Heat log" };

const QUALITY_TONE: Record<string, "teal" | "amber" | "red" | "neutral"> = { COMPLETE: "teal", PARTIAL: "amber", NO_METER_DATA: "red", OPEN: "neutral", NOT_ANALYSED: "neutral" };

export default async function HeatsPage(props: PageProps<"/heats">) {
  const sp = await props.searchParams;
  const actor = await requireActor();
  const db = getDb();
  const { day, days } = await selectedDay(actor);
  const filterDay = typeof sp.day === "string" ? sp.day : sp.day === undefined ? (day ?? "") : "";
  const q = typeof sp.q === "string" ? sp.q : "";
  const quality = typeof sp.quality === "string" ? sp.quality : "";
  const flagged = sp.flagged === "1";
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const [res, furnace] = await Promise.all([listHeats(db, actor, { day: filterDay || undefined, q, quality, flagged, page, pageSize: 25 }), requireFurnace(db, actor.factory.id)]);
  const tz = actor.factory.timeZone;
  const pages = Math.max(1, Math.ceil(res.total / res.pageSize));
  const qs = (over: Record<string, string | number>) => {
    const p = new URLSearchParams({ day: filterDay, q, quality, ...(flagged ? { flagged: "1" } : {}), page: String(page) });
    for (const [k, v] of Object.entries(over)) p.set(k, String(v));
    return `/heats?${p.toString()}`;
  };
  const now = requestNow();
  const nowDefault = `${localDate(now, tz)}T${formatLocalTime(now, tz)}`;

  return (
    <>
      <PageHeader
        title="Heat log"
        crumbs={[{ label: actor.factory.name }, { label: "Heat log" }]}
        description="Each heat links production to the energy the meter recorded while it ran. Expected energy comes from the fitted model with holding set to zero."
        actions={
          <>
            {can(actor.role, "export") ? (
              <Button asChild variant="secondary">
                <a href={`/api/export/heats?from=${filterDay || days[days.length - 1] || ""}&to=${filterDay || days[0] || ""}`}>Export CSV</a>
              </Button>
            ) : null}
            <NewHeatButton
              disabled={!can(actor.role, "heat.write")}
              capacityKg={furnace.capacityKg}
              defaults={{ heatNo: "", grade: "", orderCode: "", chargeKg: furnace.capacityKg, pouredKg: null, startAt: nowDefault, tapAt: "", mouldSet: null, mouldReadyAt: "", manualKwh: null, operatorNotes: "" }}
            />
          </>
        }
      />
      <Panel>
        <form className="flex flex-wrap items-end gap-3 border-b border-line p-3" action="/heats">
          <div className="flex flex-col gap-1">
            <label htmlFor="f-day" className="text-[12px] font-medium text-ink-2">
              Day
            </label>
            <Select id="f-day" name="day" defaultValue={filterDay} className="w-44">
              <option value="">All days</option>
              {days.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="f-q" className="text-[12px] font-medium text-ink-2">
              Search
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-ink-3" aria-hidden />
              <Input id="f-q" name="q" defaultValue={q} placeholder="Heat, grade, order, note" className="w-56 pl-8" />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="f-quality" className="text-[12px] font-medium text-ink-2">
              Data quality
            </label>
            <Select id="f-quality" name="quality" defaultValue={quality} className="w-44">
              <option value="">Any</option>
              <option value="COMPLETE">Complete</option>
              <option value="PARTIAL">Partial</option>
              <option value="NO_METER_DATA">No meter data</option>
              <option value="OPEN">Open (not tapped)</option>
            </Select>
          </div>
          <label className="flex h-9 items-center gap-2 text-[13px]">
            <input type="checkbox" name="flagged" value="1" defaultChecked={flagged} className="size-4 accent-amber-mark" /> Flagged only
          </label>
          <Button type="submit" variant="secondary">
            Apply
          </Button>
          <span className="num ml-auto text-[12px] text-ink-3">{res.total.toLocaleString("en-IN")} heats</span>
        </form>
        {res.rows.length === 0 ? (
          <EmptyState icon={Flame} title="No heats match">
            Change the filters, or log a heat. Heats need a heat number, charge and start time.
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Heat</Th>
                <Th>Day</Th>
                <Th align="right">Start</Th>
                <Th align="right">Tap</Th>
                <Th align="right">Charge kg</Th>
                <Th align="right">Poured kg</Th>
                <Th align="right">Actual kWh</Th>
                <Th align="right">Expected kWh</Th>
                <Th align="right">Variance</Th>
                <Th align="right">kWh/t</Th>
                <Th align="right">Holding min</Th>
                <Th>Quality</Th>
                <Th>Source</Th>
              </tr>
            </thead>
            <tbody>
              {res.rows.map((h) => {
                const kwh = h.meterKwh ?? h.manualKwh;
                const v = kwh !== null && h.expectedKwh ? kwh - h.expectedKwh : null;
                return (
                  <tr key={h.id} className="hover:bg-surface-2">
                    <Td>
                      <Link href={`/heats/${h.id}`} className="font-semibold text-blue hover:underline">
                        {h.heatNo}
                      </Link>
                      {h.anomaly ? (
                        <Badge tone={h.anomaly.severity === "HIGH" ? "amber" : "neutral"} className="ml-2">
                          {h.anomaly.severity}
                        </Badge>
                      ) : null}
                    </Td>
                    <Td className="num text-ink-2">{h.dayDate}</Td>
                    <Td align="right">{localTime(h.startAt, tz)}</Td>
                    <Td align="right">{localTime(h.tapAt, tz)}</Td>
                    <Td align="right">{fmt(h.chargeKg)}</Td>
                    <Td align="right">{fmt(h.pouredKg)}</Td>
                    <Td align="right">
                      {fmt(kwh, 1)}
                      {h.meterKwh === null && h.manualKwh !== null ? <span className="ml-1 text-[11px] text-ink-3">manual</span> : null}
                    </Td>
                    <Td align="right" className="text-ink-2">
                      {fmt(h.expectedKwh, 1)}
                    </Td>
                    <Td align="right" className={v !== null && h.anomaly ? "font-semibold text-amber" : ""}>
                      {v === null ? "—" : `${v >= 0 ? "+" : "−"}${fmt(Math.abs(v), 1)}`} <span className="text-[11px] text-ink-3">{pct(v !== null && h.expectedKwh ? (100 * v) / h.expectedKwh : null)}</span>
                    </Td>
                    <Td align="right">{kwh !== null && h.pouredKg ? fmt(kwh / (h.pouredKg / 1000), 1) : "—"}</Td>
                    <Td align="right" className={h.holdingMinutes ? "text-amber" : ""}>
                      {fmt(h.holdingMinutes)}
                    </Td>
                    <Td>
                      <Badge tone={QUALITY_TONE[h.dataQuality]}>{h.dataQuality.replace(/_/g, " ")}</Badge>
                    </Td>
                    <Td>
                      <Evidence label={h.provenance} />
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <div className="flex items-center justify-between gap-2 p-3 text-[13px]">
          <span className="num text-ink-3">
            Page {res.page} of {pages}
          </span>
          <div className="flex gap-2">
            <Button asChild variant="secondary" size="sm" className={page <= 1 ? "pointer-events-none opacity-40" : ""}>
              <Link href={qs({ page: page - 1 })} aria-disabled={page <= 1}>
                Previous
              </Link>
            </Button>
            <Button asChild variant="secondary" size="sm" className={page >= pages ? "pointer-events-none opacity-40" : ""}>
              <Link href={qs({ page: page + 1 })} aria-disabled={page >= pages}>
                Next
              </Link>
            </Button>
          </div>
        </div>
      </Panel>
    </>
  );
}
