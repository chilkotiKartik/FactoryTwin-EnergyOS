import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { requireActor } from "@/server/auth/session-next";
import { getHeat } from "@/server/services/heats";
import { heatAnalysisDetail } from "@/server/services/analysis";
import { dayTrace } from "@/server/services/analytics";
import { requireFurnace } from "@/server/services/common";
import { can } from "@/server/permissions";
import { ANOMALY_RULE_TEXT } from "@/domain/anomaly";
import { localDayStart } from "@/domain/time";
import { PageHeader } from "@/components/ui/page-header";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { Badge, Evidence } from "@/components/ui/badge";
import { EnergyTimeline } from "@/components/charts/energy-timeline";
import { EditHeatButton } from "@/components/heats/new-heat-button";
import { AnomalyStatus } from "@/components/heats/anomaly-status";
import { fmt, localTime, pct, toLocalInput } from "@/lib/format";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Heat" };

const LEVEL: Record<string, { tone: "teal" | "blue" | "amber" | "neutral"; text: string; help: string }> = {
  CONFIRMED: { tone: "teal", text: "Confirmed fact", help: "Seen directly in the meter readings or the heat log." },
  STRONG: { tone: "blue", text: "Strong evidence", help: "Two independent records agree (meter and heat log)." },
  HYPOTHESIS: { tone: "amber", text: "Hypothesis", help: "Plausible, but the data cannot confirm it." },
  INSUFFICIENT: { tone: "neutral", text: "Insufficient evidence", help: "Data are missing; no cause can be assigned." },
};

export default async function HeatPage(props: PageProps<"/heats/[id]">) {
  const { id } = await props.params;
  const actor = await requireActor();
  const db = getDb();
  const row = await getHeat(db, actor, id);
  if (!row) notFound();
  const h = row.h;
  const tz = actor.factory.timeZone;
  const [detail, trace, furnace] = await Promise.all([heatAnalysisDetail(db, actor, id), dayTrace(db, actor, h.dayDate), requireFurnace(db, actor.factory.id)]);
  const a = detail?.analysis ?? null;
  const dayStart = localDayStart(h.dayDate, tz);
  const toMin = (ts: number) => Math.round((ts - dayStart) / 60000);
  const fromMin = Math.max(0, toMin(h.startAt) - 25);
  const toMinV = Math.min(1440, toMin(h.tapAt ?? h.startAt) + 25);
  const holdSpans = a ? a.phases.filter((p) => p.kind === "HOLD" && a.metalReadyAt !== null && p.from >= a.metalReadyAt && p.minutes >= 3).map((p) => ({ fromMin: toMin(p.from), toMin: toMin(p.to) })) : [];
  const kwh = h.meterKwh ?? h.manualKwh;
  const anomaly = detail?.anomaly;
  const model = detail?.model;

  const events = [
    { t: h.startAt, label: "Melt started (heat log)", tone: "ink" },
    { t: a?.metalReadyAt ?? h.meltEndAt, label: a?.metalReadyAt ? "Metal ready: full power ended (meter)" : "Metal ready (heat log)", tone: "ink" },
    { t: h.mouldReadyAt, label: h.mouldSet ? `Mould set ${h.mouldSet} ready (heat log)` : "Mould ready (heat log)", tone: "teal" },
    { t: h.tapAt, label: "Tapped (heat log)", tone: "ink" },
  ]
    .filter((e) => e.t !== null && e.t !== undefined)
    .sort((x, y) => x.t! - y.t!);

  return (
    <>
      <PageHeader
        title={`Heat ${h.heatNo}`}
        crumbs={[{ label: "Heat log", href: "/heats" }, { label: h.dayDate, href: `/heats?day=${h.dayDate}` }, { label: h.heatNo }]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {h.grade || "Grade not recorded"} · {h.orderCode ?? "no order"} · {localTime(h.startAt, tz)}–{localTime(h.tapAt, tz)} <Evidence label={h.provenance} />
            {anomaly?.severity ? <Badge tone={anomaly.severity === "HIGH" ? "amber" : "neutral"}>{anomaly.severity} variance</Badge> : null}
          </span>
        }
        actions={
          can(actor.role, "heat.write") ? (
            <EditHeatButton
              heatId={h.id}
              revision={h.revision}
              capacityKg={furnace.capacityKg}
              defaults={{
                heatNo: h.heatNo,
                grade: h.grade,
                orderCode: h.orderCode ?? "",
                chargeKg: h.chargeKg,
                pouredKg: h.pouredKg,
                startAt: toLocalInput(h.startAt, tz),
                tapAt: toLocalInput(h.tapAt, tz),
                mouldSet: h.mouldSet,
                mouldReadyAt: toLocalInput(h.mouldReadyAt, tz),
                manualKwh: h.manualKwh,
                operatorNotes: h.operatorNotes,
              }}
            />
          ) : null
        }
      />

      <div className="mb-5 grid gap-5 lg:grid-cols-[1fr_340px]">
        <Panel>
          <PanelHeader title="Expected vs actual" subtitle="Expected = model prediction for this charge and start condition, with holding set to zero." />
          <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4">
            {[
              ["Actual", fmt(kwh, 1), "kWh", h.meterKwh !== null ? "Σ meter readings, start → tap" : "Manual entry"],
              ["Expected", fmt(a?.expectedKwh ?? h.expectedKwh, 1), "kWh", model ? `${model.kind === "OLS" ? "Robust least-squares fit" : "Physics prior"} · ${model.version}` : "—"],
              ["Variance", a?.varianceKwh != null ? `${a.varianceKwh >= 0 ? "+" : "−"}${fmt(Math.abs(a.varianceKwh), 1)}` : "—", "kWh", pct(a?.variancePct)],
              ["kWh per tonne", kwh !== null && h.pouredKg ? fmt(kwh / (h.pouredKg / 1000), 1) : "—", "kWh/t", `${fmt(h.pouredKg)} kg poured`],
            ].map(([k, v, u, s]) => (
              <div key={k} className="bg-surface px-4 py-3">
                <p className="text-[12px] text-ink-3">{k}</p>
                <p className={cn("num mt-1 text-[24px] font-semibold leading-none", k === "Variance" && anomaly?.severity ? "text-amber" : "")}>
                  {v} <span className="text-[12px] font-normal text-ink-3">{u}</span>
                </p>
                <p className="mt-1 text-[12px] text-ink-3">{s}</p>
              </div>
            ))}
          </div>
          <PanelBody>
            <EnergyTimeline
              points={trace.points}
              heats={trace.heats}
              tariffBands={trace.tariffBands}
              fromMin={fromMin}
              toMin={toMinV}
              highlightHeatId={h.id}
              holdSpans={holdSpans}
              height={240}
              ariaLabel={`Power trace for heat ${h.heatNo}`}
            />
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title="Production events" subtitle="Factory-local time" />
          <PanelBody>
            <ol className="relative ml-2 border-l border-line-strong">
              {events.map((e, i) => (
                <li key={i} className="mb-4 ml-4 last:mb-0">
                  <span className={cn("absolute -left-[5px] mt-1.5 size-2.5 rounded-full", e.tone === "teal" ? "bg-teal" : "bg-ink")} aria-hidden />
                  <p className="num text-[14px] font-semibold">{localTime(e.t!, tz)}</p>
                  <p className="text-[13px] text-ink-2">{e.label}</p>
                </li>
              ))}
            </ol>
            <dl className="mt-5 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-line pt-4 text-[13px]">
              <dt className="text-ink-3">Melt at full power</dt>
              <dd className="num text-right">{a ? `${fmt(a.meltMinutes)} min` : "—"}</dd>
              <dt className="text-ink-3">Holding (trace)</dt>
              <dd className={cn("num text-right", a?.holdingMinutes ? "font-semibold text-amber" : "")}>{a ? `${fmt(a.holdingMinutes)} min · ${fmt(a.holdingKwh, 1)} kWh` : "—"}</dd>
              <dt className="text-ink-3">Cold start</dt>
              <dd className="text-right">{h.coldStart ? "Yes" : "No"}</dd>
              <dt className="text-ink-3">Meter coverage</dt>
              <dd className="num text-right">{a ? `${fmt(a.completeness * 100, 1)}%` : "—"}</dd>
              <dt className="text-ink-3">Charge</dt>
              <dd className="num text-right">{fmt(h.chargeKg)} kg</dd>
            </dl>
          </PanelBody>
        </Panel>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <Panel>
          <PanelHeader
            title="Explanation"
            subtitle={a?.explanation ?? "Heat not tapped yet; no analysis."}
            actions={anomaly && can(actor.role, "analysis.run") ? <AnomalyStatus id={anomaly.id} status={anomaly.status} /> : anomaly ? <Badge>{anomaly.status}</Badge> : null}
          />
          <PanelBody className="flex flex-col gap-3">
            {a?.findings.length ? (
              a.findings.map((f, i) => (
                <div key={i} className="rounded-md border border-line p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={LEVEL[f.level].tone} title={LEVEL[f.level].help}>
                      {LEVEL[f.level].text}
                    </Badge>
                    <span className="text-[11px] uppercase tracking-wide text-ink-3">Source: {f.source.replace("+", " + ").replace("_", " ").toLowerCase()}</span>
                  </div>
                  <p className="mt-2 text-[14px] font-semibold">{f.title}</p>
                  <p className="mt-0.5 text-[13px] text-ink-2">{f.detail}</p>
                </div>
              ))
            ) : (
              <p className="text-[13px] text-ink-3">No findings: the heat used what the model expected, within tolerance.</p>
            )}
            {a?.suggestedInvestigation.length ? (
              <div className="rounded-md bg-amber-soft/60 p-3">
                <p className="text-[12px] font-semibold uppercase tracking-wide text-amber">Suggested investigation</p>
                <ul className="mt-1 list-disc pl-5 text-[13px] text-ink">
                  {a.suggestedInvestigation.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="text-[12px] text-ink-3">
              Not inferred: furnace-lid position, slag condition, charge chemistry and similar states cannot be seen in an energy trace and are never claimed.
            </p>
          </PanelBody>
        </Panel>
        <Panel>
          <PanelHeader title="Model and rule" />
          <PanelBody className="text-[13px]">
            {model ? (
              <>
                <p className="font-medium">
                  {model.version} · {model.kind === "OLS" ? "robust least-squares fit" : "physics prior"}
                </p>
                <p className="num mt-1 text-ink-2">
                  kWh ≈ {fmt(model.coefficients.intercept, 1)} + {fmt(model.coefficients.perTonne, 1)}·t + {fmt(model.coefficients.coldStart, 1)}·cold + {fmt(model.coefficients.perHoldMinute, 2)}·hold_min
                </p>
                <p className="num mt-1 text-ink-3">
                  n = {model.n} · R² {fmt(model.r2, 3)} · RMSE {fmt(model.rmseKwh, 2)} kWh
                </p>
                <p className="mt-3 text-ink-2">{ANOMALY_RULE_TEXT}</p>
                <p className="num mt-1 text-ink-3">Threshold for this heat: {fmt(a?.thresholdKwh, 1)} kWh</p>
              </>
            ) : null}
            <dl className="mt-4 grid grid-cols-2 gap-y-1.5 border-t border-line pt-3 text-[12px]">
              <dt className="text-ink-3">Record source</dt>
              <dd className="text-right">
                <Evidence label={h.provenance} />
              </dd>
              <dt className="text-ink-3">Revision</dt>
              <dd className="num text-right">{h.revision}</dd>
              <dt className="text-ink-3">Created by</dt>
              <dd className="text-right">{row.createdByName ?? (h.provenance === "SIMULATED" ? "Scenario engine" : "—")}</dd>
              <dt className="text-ink-3">Last updated</dt>
              <dd className="num text-right">{localTime(h.updatedAt, tz, true)}</dd>
            </dl>
            <Link href={`/audit?entity=${h.id}`} className="mt-3 inline-block text-[12px] text-blue hover:underline">
              View audit history
            </Link>
          </PanelBody>
        </Panel>
      </div>
      {h.operatorNotes ? (
        <Panel className="mt-5">
          <PanelHeader title="Operator note" />
          <PanelBody className="text-[14px]">{h.operatorNotes}</PanelBody>
        </Panel>
      ) : null}
    </>
  );
}
