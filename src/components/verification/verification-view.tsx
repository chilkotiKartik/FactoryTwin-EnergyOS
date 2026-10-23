import { AlertTriangle } from "lucide-react";
import type { Verification } from "@/server/services/verification";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { Evidence } from "@/components/ui/badge";
import { Table, Td, Th } from "@/components/ui/table";
import { dayLabel, fmt, inr, inrRupees, pct, signed } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { Predicted } from "@/components/optimizer/schedule-views";

const timeOf = (ts: number | null, tz: string) =>
  ts ? new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ts)) : "—";

/** Before/after verification. Every figure carries its evidence label; predictions and outcomes stay separate. */
export function VerificationView({ v, tz }: { v: Verification; tz: string }) {
  const b = v.baseline;
  const c = v.comparison;
  const s = v.savings;
  const pred = v.prediction as (Predicted & { version: number }) | null;
  const good = (x: number | null) => (x === null ? "text-ink" : x < 0 ? "text-teal" : x > 0 ? "text-amber" : "text-ink");
  const rows: { k: string; a: string; b: string; d: string; dv: number | null }[] = [
    { k: "Heats tapped", a: fmt(b.heats), b: fmt(c.heats), d: signed(c.heats - b.heats), dv: null },
    { k: "Tonnes poured", a: `${fmt(b.tonnesPoured, 2)} t`, b: `${fmt(c.tonnesPoured, 2)} t`, d: `${signed(c.tonnesPoured - b.tonnesPoured, 2)} t`, dv: null },
    { k: "Furnace energy", a: `${fmt(b.energyKwh, 1)} kWh`, b: `${fmt(c.energyKwh, 1)} kWh`, d: `${signed(c.energyKwh - b.energyKwh, 1)} kWh`, dv: c.energyKwh - b.energyKwh },
    { k: "Specific energy (SEC)", a: `${fmt(s.secBaseline, 1)} kWh/t`, b: `${fmt(s.secComparison, 1)} kWh/t`, d: pct(s.secChangePercent, 2), dv: s.secChangePercent },
    { k: "Energy cost", a: inr(b.costPaise), b: inr(c.costPaise), d: inr(c.costPaise - b.costPaise), dv: c.costPaise - b.costPaise },
    { k: "Cost per tonne", a: inr(s.costPerTonneBaseline), b: inr(s.costPerTonneComparison), d: pct(s.costPerTonneChangePercent, 2), dv: s.costPerTonneChangePercent },
    { k: "Holding at temperature", a: `${fmt(b.holdingMinutes)} min · ${fmt(b.holdingKwh, 0)} kWh`, b: `${fmt(c.holdingMinutes)} min · ${fmt(c.holdingKwh, 0)} kWh`, d: `${signed(c.holdingMinutes - b.holdingMinutes)} min`, dv: c.holdingMinutes - b.holdingMinutes },
    { k: "First start / last tap", a: `${timeOf(b.firstStartAt, tz)} / ${timeOf(b.lastTapAt, tz)}`, b: `${timeOf(c.firstStartAt, tz)} / ${timeOf(c.lastTapAt, tz)}`, d: "", dv: null },
    { k: "Meter completeness (operating)", a: pct(b.completeness === null ? null : b.completeness * 100, 1, false), b: pct(c.completeness === null ? null : c.completeness * 100, 1, false), d: "", dv: null },
    { k: "Grid emissions", a: `${fmt(b.emissionsKg, 0)} kg CO₂`, b: `${fmt(c.emissionsKg, 0)} kg CO₂`, d: `${signed((c.emissionsKg ?? 0) - (b.emissionsKg ?? 0), 0)} kg`, dv: (c.emissionsKg ?? 0) - (b.emissionsKg ?? 0) },
  ];
  const pb = v.payback;
  return (
    <div className="flex flex-col gap-4">
      {v.evidenceLabel !== "MEASURED" ? (
        <div className={cn("flex items-start gap-3 rounded-lg border px-4 py-3 text-[14px]", v.evidenceLabel === "SIMULATED" ? "border-violet/30 bg-violet/5" : "border-line bg-surface-2")}>
          <Evidence label={v.evidenceLabel} />
          <p className="text-ink-2">
            {v.evidenceLabel === "SIMULATED"
              ? "Both days come from the scenario engine. This shows how verification works; it is not evidence of a field saving."
              : v.evidenceLabel === "UNVERIFIED"
                ? "At least one day uses data without a declared genuine meter source. Treat results as indicative."
                : "One of the days has no data."}
          </p>
        </div>
      ) : null}
      {v.warnings.length ? (
        <ul className="flex flex-col gap-1.5">
          {v.warnings.map((w, i) => (
            <li key={i} className="flex items-start gap-2 text-[13px] text-amber">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {w}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 xl:grid-cols-4">
        <Big label="SEC change (per tonne)" value={pct(s.secChangePercent, 2)} tone={good(s.secChangePercent)} sub={`${fmt(s.secBaseline, 1)} → ${fmt(s.secComparison, 1)} kWh/t`} evidence={v.evidenceLabel} />
        <Big label="Cost per tonne change" value={pct(s.costPerTonneChangePercent, 2)} tone={good(s.costPerTonneChangePercent)} sub={`${inr(s.costPerTonneBaseline)} → ${inr(s.costPerTonneComparison)} /t`} evidence={v.evidenceLabel} />
        <Big label="Avoided CO₂ (like-for-like)" value={v.avoidedEmissionsKg === null ? "—" : `${fmt(v.avoidedEmissionsKg, 0)} kg`} tone="text-ink" sub={`Avoided kWh × ${v.emissionFactor.value} kg/kWh`} evidence={v.evidenceLabel} />
        <Big
          label="Simple payback"
          value={pb.status === "PAYS_BACK" ? `${fmt(pb.paybackMonths, 1)} months` : pb.status === "NOT_RECOVERED" ? "Not recovered" : "Check inputs"}
          tone={pb.status === "PAYS_BACK" ? "text-teal" : "text-amber"}
          sub={`Net ${inrRupees(pb.annualNetSavingInr)}/yr · break-even ${pb.breakEvenRealisation === null ? "—" : pct(pb.breakEvenRealisation * 100, 1, false)} realisation`}
          evidence="MODELLED"
        />
      </div>

      <Panel>
        <PanelHeader title="Baseline vs comparison" subtitle={`${dayLabel(b.day)} (baseline) vs ${dayLabel(c.day)} (comparison)`} />
        <Table>
          <thead>
            <tr>
              <Th>Measure</Th>
              <Th align="right">Baseline</Th>
              <Th align="right">Comparison</Th>
              <Th align="right">Change</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.k}>
                <Td className="text-ink-2">{r.k}</Td>
                <Td align="right">{r.a}</Td>
                <Td align="right">{r.b}</Td>
                <Td align="right" className={cn("font-medium", good(r.dv))}>
                  {r.d}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Predicted vs outcome" subtitle="Optimiser prediction (modelled) next to the recorded outcome." />
          <PanelBody>
            {pred ? (
              <Table>
                <thead>
                  <tr>
                    <Th>Measure</Th>
                    <Th align="right">Predicted (v{pred.version})</Th>
                    <Th align="right">Outcome</Th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <Td className="text-ink-2">SEC change</Td>
                    <Td align="right">{pct(pred.current.sec && pred.recommended.sec ? (100 * (pred.recommended.sec - pred.current.sec)) / pred.current.sec : null, 2)}</Td>
                    <Td align="right">{pct(s.secChangePercent, 2)}</Td>
                  </tr>
                  <tr>
                    <Td className="text-ink-2">Cost per tonne change</Td>
                    <Td align="right">{pct(pred.current.costPerTonnePaise && pred.recommended.costPerTonnePaise ? (100 * (pred.recommended.costPerTonnePaise - pred.current.costPerTonnePaise)) / pred.current.costPerTonnePaise : null, 2)}</Td>
                    <Td align="right">{pct(s.costPerTonneChangePercent, 2)}</Td>
                  </tr>
                  <tr>
                    <Td className="text-ink-2">Holding minutes</Td>
                    <Td align="right">{fmt(pred.recommended.holdMinutes)}</Td>
                    <Td align="right">{fmt(c.holdingMinutes)}</Td>
                  </tr>
                </tbody>
              </Table>
            ) : (
              <p className="text-[13px] text-ink-3">No recommendation was executed on the comparison day, so there is no prediction to compare.</p>
            )}
          </PanelBody>
        </Panel>
        <Panel>
          <PanelHeader title="Payback assumptions" subtitle="Business-case inputs, not measurements." />
          <PanelBody className="flex flex-col gap-1.5 text-[13px]">
            <KV k="Daily saving used" v={`${inrRupees(pb.annualGrossSavingInr / Math.max(1, v.assumptions.operatingDaysPerYear) / Math.max(0.0001, v.assumptions.realisationPct / 100))} (per-tonne saving × baseline tonnes)`} />
            <KV k="Operating days per year" v={fmt(v.assumptions.operatingDaysPerYear)} />
            <KV k="Realisation" v={`${fmt(v.assumptions.realisationPct)}%`} />
            <KV k="Capex" v={inrRupees(v.assumptions.capexInr)} />
            <KV k="Opex per year" v={inrRupees(v.assumptions.opexInrPerYear)} />
            <KV k="Annual gross / net" v={`${inrRupees(pb.annualGrossSavingInr)} / ${inrRupees(pb.annualNetSavingInr)}`} />
            <p className="mt-1 text-ink-3">{pb.message}</p>
            <p className="flex items-center gap-2 text-ink-3">
              <Evidence label="ASSUMPTION" /> Emission factor {v.emissionFactor.value} kg CO₂/kWh · {v.emissionFactor.source}
            </p>
          </PanelBody>
        </Panel>
      </div>

      <Panel>
        <PanelHeader title="Methodology" />
        <PanelBody className="text-[13px] text-ink-2">
          <p>{v.methodology}</p>
          <p className="mt-2">
            Tariff in force:{" "}
            {v.tariff.versions.map((t) => `${t.name} v${t.version} (normal ₹${(t.normalRatePaise / 100).toFixed(2)}/kWh; ${t.periods.map((p) => `${p.label} ₹${(p.ratePaise / 100).toFixed(2)}`).join(", ")})`).join("; ")}
          </p>
        </PanelBody>
      </Panel>
    </div>
  );
}

function Big({ label, value, sub, tone, evidence }: { label: string; value: string; sub: string; tone: string; evidence: string }) {
  return (
    <div className="flex flex-col gap-1 bg-surface px-4 py-3">
      <span className="text-[12px] font-medium text-ink-3">{label}</span>
      <span className={cn("num text-[26px] font-semibold leading-tight", tone)}>{value}</span>
      <span className="num text-[12px] text-ink-3">{sub}</span>
      <span>
        <Evidence label={evidence} />
      </span>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-line pb-1">
      <span className="text-ink-3">{k}</span>
      <span className="num text-right">{v}</span>
    </div>
  );
}
