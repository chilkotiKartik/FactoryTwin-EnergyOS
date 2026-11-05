"use client";

import { useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import { estimateSavings, type SavingsInput } from "@/domain/savings";
import { Evidence } from "@/components/ui/badge";
import { fmt, inrRupees } from "@/lib/format";
import { cn } from "@/lib/cn";

type Key = keyof SavingsInput;
const FIELDS: { k: Key; label: string; unit: string; min: number; max: number; step: number; hint: string }[] = [
  { k: "tonnesPerMonth", label: "Tonnes poured per month", unit: "t", min: 10, max: 2000, step: 5, hint: "From your heat log" },
  { k: "secKwhPerT", label: "Specific energy now", unit: "kWh/t", min: 450, max: 1200, step: 5, hint: "CII norm 620; measured plants 660–700" },
  { k: "holdingPct", label: "Energy spent holding", unit: "% of kWh", min: 0, max: 20, step: 0.1, hint: "Detected from the 1-minute trace" },
  { k: "holdingRecoverablePct", label: "Holding that timing can remove", unit: "%", min: 0, max: 100, step: 5, hint: "Assumption: not every wait is avoidable" },
  { k: "shiftablePct", label: "Melting that can move to solar hours", unit: "% of kWh", min: 0, max: 100, step: 5, hint: "Limited by moulds, crew and deadlines" },
  { k: "normalRate", label: "Normal energy rate", unit: "₹/kWh", min: 4, max: 15, step: 0.1, hint: "From your tariff in force" },
  { k: "solarDiscountPct", label: "Solar-hour discount", unit: "%", min: 0, max: 40, step: 1, hint: "2023 ToD rules: at least 20%" },
  { k: "opexRupeesPerMonth", label: "Running cost", unit: "₹/month", min: 0, max: 50000, step: 500, hint: "Assumption" },
  { k: "capexRupees", label: "One-off cost", unit: "₹", min: 0, max: 1000000, step: 5000, hint: "Assumption (meter + set-up)" },
];

/** Transparent what-could-this-be-worth estimate. Inputs start from the plant's own data. */
export function SavingsCalculator({ initial, basis }: { initial: SavingsInput; basis: string }) {
  const [v, setV] = useState<SavingsInput>(initial);
  const r = useMemo(() => estimateSavings(v), [v]);
  const changed = JSON.stringify(v) !== JSON.stringify(initial);
  const big = [
    { k: "Saving per year", v: inrRupees(r.rupeesSavedPerYear), tone: "teal" },
    { k: "Payback", v: r.paybackMonths === null ? "not reached" : `${fmt(r.paybackMonths, 1)} months`, tone: r.paybackMonths !== null && r.paybackMonths <= 12 ? "teal" : "amber" },
    { k: "CO₂ avoided per year", v: `${fmt(r.co2TonnesPerYear, 1)} t`, tone: "neutral" },
    { k: "SEC after", v: r.secAfter === null ? "—" : `${fmt(r.secAfter, 0)} kWh/t`, tone: "neutral" },
  ] as const;
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <div key={f.k} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <label htmlFor={`sv-${f.k}`} className="text-[12.5px] font-medium text-ink-2">
                {f.label}
              </label>
              <span className="num text-[13px] font-semibold text-ink">
                {fmt(v[f.k], f.step < 1 ? 1 : 0)} <span className="font-normal text-ink-3">{f.unit}</span>
              </span>
            </div>
            <input id={`sv-${f.k}`} type="range" min={f.min} max={f.max} step={f.step} value={Math.min(f.max, Math.max(f.min, v[f.k]))} onChange={(e) => setV({ ...v, [f.k]: Number(e.target.value) })} className="w-full" />
            <span className="text-[11.5px] text-ink-3">{f.hint}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-3">
        <div className="relative overflow-hidden rounded-2xl border border-line bg-surface-2 p-5">
          <div aria-hidden className="brand-gradient absolute inset-x-0 top-0 h-1" />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-semibold">Estimated potential</span>
            <Evidence label="MODELLED" />
            {changed ? (
              <button type="button" onClick={() => setV(initial)} className="ml-auto inline-flex items-center gap-1 text-[12px] font-medium text-blue hover:underline">
                <RotateCcw className="size-3" aria-hidden /> Your data
              </button>
            ) : null}
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-4" aria-live="polite">
            {big.map((b) => (
              <div key={b.k}>
                <dt className="text-[12px] text-ink-3">{b.k}</dt>
                <dd className={cn("num mt-0.5 text-[22px] font-semibold leading-tight tracking-tight", b.tone === "teal" ? "text-teal" : b.tone === "amber" ? "text-amber" : "text-ink")}>{b.v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 space-y-1.5 border-t border-line pt-3 text-[12.5px]">
            <Row k="From removing holding" v={`${inrRupees(r.rupeesFromHoldingPerMonth)}/month`} />
            <Row k="From solar-hour timing" v={`${inrRupees(r.rupeesFromShiftPerMonth)}/month`} />
            <Row k="Energy saved" v={`${fmt(r.kwhSavedPerMonth, 0)} kWh/month`} />
            <Row k="Net of running cost" v={`${inrRupees(r.netRupeesPerMonth)}/month`} />
          </div>
        </div>
        <p className="text-[12px] leading-relaxed text-ink-3">
          Starting values: {basis}. Holding energy is valued at the normal rate; shifted energy at the solar discount. This is an estimate to decide whether a pilot is worth it, not a saving. Savings count only after an outcome is recorded and verified per tonne on the Verification page.
        </p>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-ink-3">{k}</span>
      <span className="num text-ink">{v}</span>
    </div>
  );
}
