import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { ArrowRight, Gauge } from "lucide-react";
import { getDb } from "@/db/client";
import { optimizationRuns, productionPlans } from "@/db/schema";
import { requireActor } from "@/server/auth/session-next";
import { selectedDay } from "@/server/day";
import { dailySeries, dayTrace, rangeSummary } from "@/server/services/analytics";
import { decisionLoop } from "@/server/services/loop";
import { addDays } from "@/domain/time";
import { DECK_REFERENCE } from "@/domain/scenarios";
import { PageHeader } from "@/components/ui/page-header";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { Stat } from "@/components/ui/stat";
import { Evidence, Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty";
import { Button } from "@/components/ui/button";
import { DecisionLoop } from "@/components/dashboard/decision-loop";
import { EnergyTimeline } from "@/components/charts/energy-timeline";
import { SecByHeat } from "@/components/charts/sec-by-heat";
import { DailyTrend } from "@/components/charts/daily-trend";
import { dayLabel, fmt, hhmm, inr, pct } from "@/lib/format";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Dashboard" };

const RANGES = { day: { label: "Day", days: 1 }, "7d": { label: "7 days", days: 7 }, "30d": { label: "30 days", days: 30 } } as const;
type RangeKey = keyof typeof RANGES;

export default async function DashboardPage(props: PageProps<"/dashboard">) {
  const sp = await props.searchParams;
  const actor = await requireActor();
  const db = getDb();
  const { day } = await selectedDay(actor, sp.day);
  const range: RangeKey = typeof sp.range === "string" && sp.range in RANGES ? (sp.range as RangeKey) : "day";

  if (!day) {
    return (
      <>
        <PageHeader title="Operations dashboard" crumbs={[{ label: actor.factory.name }, { label: "Dashboard" }]} />
        <Panel>
          <EmptyState icon={Gauge} title="No production data yet" action={<Button asChild><Link href="/meters">Import meter data</Link></Button>}>
            This factory has no heats or meter readings. Import a meter CSV and log heats on the Heat log, or connect a meter through the ingest API (see Factory settings).
          </EmptyState>
        </Panel>
      </>
    );
  }

  const fromDay = addDays(day, -(RANGES[range].days - 1));
  const [sum, daySum, trace, series, plan] = await Promise.all([
    rangeSummary(db, actor, fromDay, day),
    range === "day" ? null : rangeSummary(db, actor, day, day),
    range === "day" ? dayTrace(db, actor, day) : null,
    dailySeries(db, actor, addDays(day, -29), day),
    db.query.productionPlans.findFirst({ where: eq(productionPlans.factoryId, actor.factory.id), orderBy: desc(productionPlans.planDate) }),
  ]);
  const loop = await decisionLoop(db, actor, daySum ?? sum);
  const run = plan ? await db.query.optimizationRuns.findFirst({ where: eq(optimizationRuns.planId, plan.id), orderBy: desc(optimizationRuns.createdAt) }) : null;
  const runResult = run?.status === "OPTIMAL" ? (run.result as { current: { totals: Totals }; recommended: { totals: Totals } }) : null;

  const period = range === "day" ? dayLabel(day) : `${dayLabel(fromDay)} – ${dayLabel(day)}`;
  const src = "Meter: F1 incomer, 1-min readings (invalid readings excluded). Production: heat log, tapped heats.";
  const holdingPct = sum.energyKwh > 0 ? (100 * sum.holdingKwh) / sum.energyKwh : null;
  const flaggedHeats = sum.heats.filter((h) => h.anomalySeverity);

  return (
    <>
      <PageHeader
        title="Operations dashboard"
        crumbs={[{ label: actor.factory.name }, { label: "Dashboard" }]}
        description={
          <>
            A monthly bill and a monthly tonnage cannot show which heat, which wait or which hour made a tonne expensive. Every figure here is computed from stored meter readings and heat records for <span className="font-medium text-ink">{period}</span>.
          </>
        }
        actions={
          <nav aria-label="Period" className="flex rounded-md border border-line-strong bg-surface p-0.5">
            {(Object.keys(RANGES) as RangeKey[]).map((k) => (
              <Link
                key={k}
                href={`/dashboard?range=${k}`}
                aria-current={range === k ? "true" : undefined}
                className={cn("rounded px-3 py-1.5 text-[13px] font-medium", range === k ? "bg-ink text-white" : "text-ink-2 hover:bg-surface-3")}
              >
                {RANGES[k].label}
              </Link>
            ))}
          </nav>
        }
      />

      <Panel className="mb-5">
        <PanelHeader title="Decision loop" subtitle="From meter reading to verified outcome. Each step reads stored records; click a step to open it." />
        <PanelBody>
          <DecisionLoop stages={loop} />
        </PanelBody>
      </Panel>

      <Panel className="mb-5">
        <div className="grid grid-cols-2 divide-line sm:grid-cols-3 lg:grid-cols-5 [&>*]:border-b [&>*]:border-line lg:[&>*:nth-child(n+6)]:border-b-0">
          <Stat label="Energy consumed" value={fmt(sum.energyKwh, 0)} unit="kWh" evidence={sum.evidence} definition={`Σ interval kWh from the furnace meter, ${period}. ${src}`} />
          <Stat label="Tonnes poured" value={fmt(sum.tonnesPoured, 2)} unit="t" definition={`Σ poured kg of tapped heats ÷ 1000, ${period}. Source: heat log.`} delta={{ text: `${sum.heatsTapped} heats`, tone: "neutral" }} />
          <Stat label="Specific energy (SEC)" value={fmt(sum.sec, 1)} unit="kWh/t" emphasis={sum.sec && sum.sec > 650 ? "amber" : null} definition="SEC = total meter kWh ÷ tonnes poured. Kolhapur cluster profile reports 600–700 kWh/t (VERIFIED context, TERI)." />
          <Stat label="Energy cost" value={inr(sum.costPaise)} definition={`Σ interval kWh × tariff rate in force at that minute (tariff versions on the Tariffs page). Rates are ASSUMPTIONS unless marked VERIFIED. ${sum.unpricedKwh > 0 ? `${fmt(sum.unpricedKwh, 1)} kWh unpriced.` : ""}`} delta={{ text: "tariff: assumption", tone: "neutral" }} />
          <Stat label="Cost per tonne" value={inr(sum.costPerTonnePaise)} unit="/t" definition="Energy cost ÷ tonnes poured." />
          <Stat
            label="Holding energy"
            value={fmt(sum.holdingKwh, 0)}
            unit="kWh"
            emphasis={sum.holdingKwh > 0 ? "amber" : null}
            delta={{ text: `${fmt(sum.holdingMinutes, 0)} min · ${pct(holdingPct, 1, false)} of kWh`, tone: sum.holdingMinutes > 0 ? "bad" : "neutral" }}
            definition="Measured from the trace: kWh during low-power plateaus after melting and before tap (≥ 3 min). Already inside the meter total; not added again."
          />
          <Stat label="Anomalies" value={String(flaggedHeats.length)} emphasis={flaggedHeats.length ? "amber" : null} definition="Heats where actual − expected kWh exceeds max(5% of expected, 3 × model RMSE). Rule EXPECTED_VS_ACTUAL_V1." delta={{ text: `${sum.openAnomalies} open`, tone: "neutral" }} />
          <Stat label="Pending approvals" value={String(sum.pendingApprovals)} emphasis={sum.pendingApprovals ? "amber" : null} definition="Recommendations awaiting a supervisor decision (all plans)." />
          <Stat
            label="Meter data quality"
            value={sum.completenessOperating === null ? "—" : fmt(sum.completenessOperating * 100, 1)}
            unit="%"
            emphasis={sum.completenessOperating !== null && sum.completenessOperating < actor.factory.minCompleteness ? "red" : sum.completenessOperating !== null ? "teal" : null}
            delta={{ text: `${sum.gaps.length} gap${sum.gaps.length === 1 ? "" : "s"} · ${sum.invalidReadings} invalid`, tone: sum.gaps.length ? "bad" : "neutral" }}
            definition={`Readings received ÷ expected (1 per minute) between first heat start and last tap. Minimum for advice: ${(actor.factory.minCompleteness * 100).toFixed(0)}%.`}
          />
          <Stat label="Emissions (grid)" value={fmt(sum.emissionsKg !== null ? sum.emissionsKg / 1000 : null, 2)} unit="t CO₂" definition={`kWh × ${actor.factory.emissionFactor} kg CO₂/kWh (${actor.factory.emissionFactorSource}). Indirect grid emissions only.`} />
        </div>
      </Panel>

      {trace ? (
        <Panel className="mb-5">
          <PanelHeader
            title="Furnace power and heats"
            subtitle={`${dayLabel(day)} · 1-minute readings. Hover for values; click a heat to investigate.`}
            actions={<Evidence label={sum.evidence} />}
          />
          <PanelBody>
            <EnergyTimeline points={trace.points} heats={trace.heats} tariffBands={trace.tariffBands} ariaLabel={`Furnace power on ${day}, with heat intervals and tariff windows`} />
          </PanelBody>
        </Panel>
      ) : null}

      <div className="mb-5 grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <Panel>
          <PanelHeader title="kWh per tonne, per heat" subtitle={range === "day" ? "Amber = flagged against expected energy." : `Showing ${day} only; switch to Day for the trace.`} />
          <PanelBody>
            <SecByHeat
              baselineSec={(daySum ?? sum).sec}
              data={(daySum ?? sum).heats
                .filter((h) => h.tapAt)
                .map((h) => ({
                  heatNo: h.heatNo,
                  sec: h.secKwhPerT,
                  expectedSec: h.expectedKwh && h.pouredKg ? h.expectedKwh / (h.pouredKg / 1000) : null,
                  flagged: Boolean(h.anomalySeverity),
                  holding: h.holdingMinutes,
                }))}
            />
            {flaggedHeats.length ? (
              <ul className="mt-3 divide-y divide-line rounded-md border border-line">
                {flaggedHeats.slice(0, 4).map((h) => (
                  <li key={h.id}>
                    <Link href={`/heats/${h.id}`} className="flex items-center gap-3 px-3 py-2 text-[13px] hover:bg-surface-2">
                      <Badge tone={h.anomalySeverity === "HIGH" ? "amber" : "neutral"}>{h.anomalySeverity}</Badge>
                      <span className="font-medium">
                        {h.heatNo} <span className="font-normal text-ink-3">{h.dayDate}</span>
                      </span>
                      <span className="num ml-auto text-ink-2">
                        {fmt(h.meterKwh, 0)} vs {fmt(h.expectedKwh, 0)} kWh · {pct(h.variancePct)}
                      </span>
                      <ArrowRight className="size-4 text-ink-3" />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title="Baseline vs recommended" subtitle={plan ? `Plan ${plan.planDate}: current practice vs latest optimiser run` : "No plan"} actions={runResult ? <Evidence label="MODELLED" /> : null} />
          <PanelBody>
            {runResult ? (
              <CompareTable cur={runResult.current.totals} rec={runResult.recommended.totals} />
            ) : (
              <EmptyState icon={Gauge} title={run ? `Latest run: ${run.status.replace(/_/g, " ").toLowerCase()}` : "Optimiser not run yet"} action={<Button asChild variant="secondary"><Link href="/optimizer">Open optimiser</Link></Button>}>
                Predicted figures appear here after a feasible run. They are model predictions, not achieved savings.
              </EmptyState>
            )}
            {actor.factory.isSimulation ? (
              <p className="mt-3 rounded-md bg-surface-2 px-3 py-2 text-[12px] text-ink-3">
                Deck reference (synthetic script): {fmt(DECK_REFERENCE.baselineSec, 1)} → {fmt(DECK_REFERENCE.optimisedSec, 1)} kWh/t ({DECK_REFERENCE.secChangePct}%), ₹{fmt(DECK_REFERENCE.baselineCostPerTonne)} → ₹{fmt(DECK_REFERENCE.optimisedCostPerTonne)}/t ({DECK_REFERENCE.costPerTonneChangePct}%). Figures above are recomputed from this app&apos;s own dataset, so they differ slightly. See Evidence.
              </p>
            ) : null}
          </PanelBody>
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <Panel>
          <PanelHeader title="Daily SEC, last 30 days" subtitle="Per-day kWh ÷ tonnes. Amber dot = selected day." actions={<Evidence label={sum.evidence} />} />
          <PanelBody>
            <DailyTrend data={series} highlight={day} />
          </PanelBody>
        </Panel>
        <Panel>
          <PanelHeader title="Cost by tariff window" subtitle={period} />
          <PanelBody>
            <TariffSplit byKind={sum.costByKind} />
          </PanelBody>
        </Panel>
      </div>
    </>
  );
}

interface Totals {
  kwh: number;
  costPaise: number;
  holdMinutes: number;
  tonnesPoured: number;
  firstStartMin: number | null;
  lastTapMin: number | null;
  meltMinutes: number;
  meltMinutesByPrice: Record<string, number>;
}

function CompareTable({ cur, rec }: { cur: Totals; rec: Totals }) {
  const secC = cur.tonnesPoured ? cur.kwh / cur.tonnesPoured : null;
  const secR = rec.tonnesPoured ? rec.kwh / rec.tonnesPoured : null;
  const cptC = cur.tonnesPoured ? cur.costPaise / cur.tonnesPoured : null;
  const cptR = rec.tonnesPoured ? rec.costPaise / rec.tonnesPoured : null;
  const ch = (a: number | null, b: number | null) => (a && b !== null ? (100 * (b - a)) / a : null);
  const rows: [string, string, string, string][] = [
    ["kWh per tonne", fmt(secC, 1), fmt(secR, 1), pct(ch(secC, secR))],
    ["₹ per tonne", inr(cptC), inr(cptR), pct(ch(cptC, cptR))],
    ["Energy, kWh", fmt(cur.kwh, 0), fmt(rec.kwh, 0), pct(ch(cur.kwh, rec.kwh))],
    ["Holding, min", fmt(cur.holdMinutes), fmt(rec.holdMinutes), fmt(rec.holdMinutes - cur.holdMinutes)],
    ["Tonnes poured", fmt(cur.tonnesPoured, 2), fmt(rec.tonnesPoured, 2), rec.tonnesPoured === cur.tonnesPoured ? "unchanged" : fmt(rec.tonnesPoured - cur.tonnesPoured, 2)],
    ["First start", hhmm(cur.firstStartMin), hhmm(rec.firstStartMin), ""],
    ["Last tap", hhmm(cur.lastTapMin), hhmm(rec.lastTapMin), ""],
  ];
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr className="text-[11px] uppercase tracking-wide text-ink-3">
          <th className="pb-2 text-left font-semibold">Metric</th>
          <th className="pb-2 text-right font-semibold">Current</th>
          <th className="pb-2 text-right font-semibold">Recommended</th>
          <th className="pb-2 text-right font-semibold">Change</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([k, a, b, c]) => (
          <tr key={k} className="border-t border-line">
            <td className="py-1.5 text-ink-2">{k}</td>
            <td className="num py-1.5 text-right">{a}</td>
            <td className="num py-1.5 text-right font-medium">{b}</td>
            <td className={cn("num py-1.5 text-right", c.startsWith("-") || c.startsWith("−") ? "text-teal" : "text-ink-3")}>{c}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TariffSplit({ byKind }: { byKind: Record<string, { kwh: number; paise: number }> }) {
  const order = ["SOLAR", "NORMAL", "PEAK", "OFFPEAK"];
  const total = Object.values(byKind).reduce((s, v) => s + v.kwh, 0);
  const names: Record<string, string> = { SOLAR: "Solar window", NORMAL: "Normal", PEAK: "Peak", OFFPEAK: "Off-peak" };
  const color: Record<string, string> = { SOLAR: "bg-[#e7b416]", NORMAL: "bg-ink-2", PEAK: "bg-red-mark", OFFPEAK: "bg-blue" };
  const entries = order.filter((k) => byKind[k]);
  if (!entries.length) return <p className="text-[13px] text-ink-3">No priced energy in this period.</p>;
  return (
    <div>
      <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded" role="img" aria-label="Share of kWh by tariff window">
        {entries.map((k) => (
          <div key={k} className={color[k]} style={{ width: `${(100 * byKind[k].kwh) / total}%` }} />
        ))}
      </div>
      <table className="mt-3 w-full text-[13px]">
        <tbody>
          {entries.map((k) => (
            <tr key={k} className="border-t border-line">
              <td className="py-1.5">
                <span className={cn("mr-2 inline-block size-2.5 rounded-sm align-middle", color[k])} aria-hidden />
                {names[k]}
              </td>
              <td className="num py-1.5 text-right">{fmt(byKind[k].kwh, 0)} kWh</td>
              <td className="num py-1.5 text-right text-ink-3">{fmt((100 * byKind[k].kwh) / total, 1)}%</td>
              <td className="num py-1.5 text-right font-medium">{inr(byKind[k].paise)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[12px] text-ink-3">Shifting melting into the solar window lowers cost; it does not by itself lower kWh.</p>
    </div>
  );
}
