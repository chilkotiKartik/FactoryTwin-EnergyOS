"use client";

import { useEffect, useRef, useState } from "react";
import { FlaskConical, Loader2 } from "lucide-react";
import { whatIfAction } from "@/app/actions";
import type { WhatIfParams, WhatIfResult } from "@/server/services/optimization";
import { Badge } from "@/components/ui/badge";
import { fmt, hhmm, inr } from "@/lib/format";

interface Defaults {
  holdingKw: number;
  maxHoldMinutes: number;
  deadlineMin: number;
  availableFromMin: number;
  availableToMin: number;
  currentPracticeStartMin: number;
  siteCapKva: number | null;
}

/**
 * Sandbox for the optimiser: change a few inputs and see the modelled effect at once.
 * Nothing is saved; no run, recommendation or approval is created.
 */
export function WhatIf({ planId, defaults }: { planId: string; defaults: Defaults }) {
  const [reorder, setReorder] = useState(false);
  const [cap, setCap] = useState(defaults.siteCapKva === null ? "" : String(defaults.siteCapKva));
  const [p, setP] = useState({ solar: 100, peak: 100, ...defaults });
  const [res, setRes] = useState<WhatIfResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const my = ++seq.current;
    const t = setTimeout(async () => {
      setBusy(true);
      const params: WhatIfParams = {
        solarRateFactor: p.solar / 100,
        peakRateFactor: p.peak / 100,
        holdingKw: p.holdingKw,
        maxHoldMinutes: p.maxHoldMinutes,
        deadlineMin: p.deadlineMin,
        availableFromMin: p.availableFromMin,
        availableToMin: p.availableToMin,
        currentPracticeStartMin: p.currentPracticeStartMin,
        allowReorder: reorder,
        siteCapKva: cap.trim() === "" ? null : Number(cap),
      };
      const r = await whatIfAction(planId, params);
      if (my !== seq.current) return; // a newer request superseded this one
      setBusy(false);
      if (!r.ok || !r.data) return void setErr(r.message ?? "Could not compute.");
      setErr(null);
      setRes(r.data);
    }, 300);
    return () => clearTimeout(t);
  }, [p, planId, reorder, cap]);

  const reset = () => setP({ solar: 100, peak: 100, ...defaults });
  const rec = res?.recommended ?? null;
  const dirty = JSON.stringify(p) !== JSON.stringify({ solar: 100, peak: 100, ...defaults });

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Slider id="wi-solar" label="Solar-window rate" value={p.solar} min={20} max={150} step={5} unit="% of tariff" onChange={(solar) => setP({ ...p, solar })} />
        <Slider id="wi-peak" label="Peak-window rate" value={p.peak} min={50} max={250} step={5} unit="% of tariff" onChange={(peak) => setP({ ...p, peak })} />
        <Slider id="wi-hold-kw" label="Holding power" value={p.holdingKw} min={0} max={Math.max(200, defaults.holdingKw * 2)} step={5} unit="kW" onChange={(holdingKw) => setP({ ...p, holdingKw })} />
        <Slider id="wi-max-hold" label="Holding limit" value={p.maxHoldMinutes} min={0} max={240} step={5} unit="min" onChange={(maxHoldMinutes) => setP({ ...p, maxHoldMinutes })} />
        <Slider id="wi-deadline" label="Dispatch deadline" value={p.deadlineMin} min={720} max={1440} step={15} display={hhmm(p.deadlineMin)} onChange={(deadlineMin) => setP({ ...p, deadlineMin })} />
        <Slider id="wi-from" label="Furnace available from" value={p.availableFromMin} min={0} max={720} step={15} display={hhmm(p.availableFromMin)} onChange={(availableFromMin) => setP({ ...p, availableFromMin })} />
        <Slider id="wi-start" label="Current practice starts" value={p.currentPracticeStartMin} min={0} max={720} step={5} display={hhmm(p.currentPracticeStartMin)} onChange={(currentPracticeStartMin) => setP({ ...p, currentPracticeStartMin })} />
      </div>

      <label className="flex max-w-xs flex-col gap-1 text-[12px] font-medium text-ink-2">
        Contract demand cap (kVA, blank = none)
        <input inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} className="h-9 rounded-md border border-line-strong bg-surface px-3 text-sm num" />
      </label>
      <label className="flex items-center gap-2 text-[13px] text-ink-2">
        <input type="checkbox" checked={reorder} onChange={(e) => setReorder(e.target.checked)} className="size-4" />
        Allow reordering heats within an order
      </label>

      <div className="rounded-md border border-line bg-surface-2 p-3" aria-live="polite">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <FlaskConical className="size-4 text-ink-3" aria-hidden />
          <span className="text-[13px] font-semibold">Modelled result</span>
          <Badge>MODELLED · not saved</Badge>
          {busy ? <Loader2 className="size-3.5 animate-spin text-ink-3" aria-label="Computing" /> : null}
          {dirty ? (
            <button type="button" onClick={reset} className="ml-auto text-[12px] font-medium text-blue hover:underline">
              Reset to plan values
            </button>
          ) : null}
        </div>
        {err ? <p className="text-[13px] text-red">{err}</p> : null}
        {res && res.status === "INFEASIBLE" ? (
          <ul className="list-disc pl-5 text-[13px] text-ink-2">
            {res.blocking.slice(0, 3).map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        ) : null}
        {res && rec ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-4">
            <Metric label="Cost today (current practice)" value={inr(res.current.costPaise)} />
            <Metric label="Cost recommended" value={inr(rec.costPaise)} />
            <Metric label="Saving per tonne" value={res.savingPaisePerTonne === null ? "—" : inr(res.savingPaisePerTonne)} strong />
            <Metric label="Holding" value={`${fmt(res.current.holdMinutes)} → ${fmt(rec.holdMinutes)} min`} />
            <Metric label="First start" value={`${hhmm(res.current.firstStartMin)} → ${hhmm(rec.firstStartMin)}`} />
            <Metric label="Last tap" value={`${hhmm(res.current.lastTapMin)} → ${hhmm(rec.lastTapMin)}`} />
            <Metric label="Energy" value={`${fmt(res.current.kwh)} → ${fmt(rec.kwh)} kWh`} />
            <Metric label="Solved in" value={`${fmt(res.runtimeMs, 0)} ms`} />
            {res.current.peak15Kva !== null && rec.peak15Kva !== null ? <Metric label="Peak demand (15-min)" value={`${fmt(res.current.peak15Kva)} → ${fmt(rec.peak15Kva)} kVA`} /> : null}
            {res.reordered ? <Metric label="New heat order" value={res.sequence.join(" → ")} /> : null}
          </dl>
        ) : null}
      </div>
    </div>
  );
}

function Metric({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-ink-3">{label}</dt>
      <dd className={`num ${strong ? "text-[15px] font-semibold text-teal" : "text-ink"}`}>{value}</dd>
    </div>
  );
}

function Slider({ id, label, value, min, max, step, unit, display, onChange }: { id: string; label: string; value: number; min: number; max: number; step: number; unit?: string; display?: string; onChange: (v: number) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-[12px] font-medium text-ink-2">
          {label}
        </label>
        <span className="num text-[12px] text-ink">{display ?? `${value} ${unit ?? ""}`}</span>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[var(--color-blue,#2563eb)]" />
    </div>
  );
}
