"use client";

import { useDeferredValue, useId, useMemo, useState } from "react";
import { FlaskConical, RotateCcw, TriangleAlert } from "lucide-react";
import { deckDayInput, deckPeriods, type DeckDayOptions } from "@/domain/deck";
import { optimise, type ScheduleEvaluation } from "@/domain/optimizer";
import { fmt, hhmm, inr, pct } from "@/lib/format";
import { cn } from "@/lib/cn";

const DEFAULTS: Required<Pick<DeckDayOptions, "extraMouldDelayMin" | "deadlineMin" | "solarDiscount" | "peakMultiplier">> = {
  extraMouldDelayMin: 0,
  deadlineMin: 22 * 60,
  solarDiscount: 0.2,
  peakMultiplier: 1.2,
};

type Opts = typeof DEFAULTS;

function perTonne(e: ScheduleEvaluation) {
  const t = e.totals.tonnesPoured || 1;
  return { kwhT: e.totals.kwh / t, inrT: e.totals.costPaise / 100 / t };
}

/**
 * Live shift simulator. Runs the production optimiser in the browser against the
 * deck's foundry day. Every number is simulated from deck assumptions.
 */
export function ShiftSimulator() {
  const [opts, setOpts] = useState<Opts>(DEFAULTS);
  const deferred = useDeferredValue(opts);
  const result = useMemo(() => optimise(deckDayInput(deferred)), [deferred]);
  const stale = deferred !== opts;
  const cur = result.current;
  const rec = result.recommended;
  const c = perTonne(cur);
  const r = rec ? perTonne(rec) : null;
  const set = (k: keyof Opts) => (v: number) => setOpts((o) => ({ ...o, [k]: v }));
  const changed = (Object.keys(DEFAULTS) as (keyof Opts)[]).some((k) => opts[k] !== DEFAULTS[k]);

  return (
    <div className="overflow-hidden rounded-card border border-white/10 bg-surface text-ink shadow-overlay" data-testid="shift-simulator">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <p className="inline-flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-violet">
          <FlaskConical className="size-4" aria-hidden /> Simulated · deck assumptions · 12 heats × 500 kg
        </p>
        <button
          type="button"
          onClick={() => setOpts(DEFAULTS)}
          disabled={!changed}
          className="inline-flex items-center gap-1.5 rounded-control px-2 py-1 text-[12px] text-ink-2 hover:bg-surface-3 disabled:opacity-40"
        >
          <RotateCcw className="size-3.5" aria-hidden /> Reset
        </button>
      </div>
      <div className="grid gap-0 md:grid-cols-[280px_minmax(0,1fr)]">
        <fieldset className="flex flex-col gap-4 border-b border-line p-4 md:border-b-0 md:border-r">
          <legend className="sr-only">Shift conditions</legend>
          <Slider label="Moulding delay from set 7" value={opts.extraMouldDelayMin} min={0} max={60} step={5} onChange={set("extraMouldDelayMin")} display={(v) => `+${v} min`} />
          <Slider label="Dispatch cut-off" value={opts.deadlineMin} min={15 * 60} max={22 * 60} step={30} onChange={set("deadlineMin")} display={hhmm} />
          <Slider label="Solar-hours discount" value={opts.solarDiscount} min={0} max={0.4} step={0.05} onChange={set("solarDiscount")} display={(v) => `−${Math.round(v * 100)}%`} />
          <Slider label="Evening peak multiplier" value={opts.peakMultiplier} min={1} max={1.6} step={0.05} onChange={set("peakMultiplier")} display={(v) => `${v.toFixed(2)}×`} />
          <p className="text-[11.5px] leading-snug text-ink-3">The same exact optimiser and constraint checker the app uses, running in your browser in a few milliseconds.</p>
        </fieldset>
        <div className={cn("min-w-0 p-4 transition-opacity", stale && "opacity-70")} aria-live="polite" aria-busy={stale}>
          {rec && r ? (
            <>
              <div className="grid gap-3 min-[480px]:grid-cols-3">
                <Kpi label="Energy" unit="kWh/t" before={c.kwhT} after={r.kwhT} digits={0} />
                <Kpi label="Cost" unit="₹/t" before={c.inrT} after={r.inrT} digits={0} money />
                <Kpi label="Holding" unit="min" before={cur.totals.holdMinutes} after={rec.totals.holdMinutes} digits={0} />
              </div>
              <MiniGantt current={cur} recommended={rec} opts={deferred} />
              <p className="mt-3 text-[12.5px] text-ink-2">
                Recommended: start <b className="num">{hhmm(rec.totals.firstStartMin)}</b>, last tap <b className="num">{hhmm(rec.totals.lastTapMin)}</b>. Saves{" "}
                <b className="num">{inr(cur.totals.costPaise - rec.totals.costPaise)}</b> on this day, all {rec.checks.length} constraints pass.
              </p>
            </>
          ) : (
            <div className="flex h-full flex-col justify-center gap-2 rounded-card border border-red/25 bg-red-soft p-4 text-[13px] text-red" data-testid="sim-infeasible">
              <p className="inline-flex items-center gap-2 font-semibold">
                <TriangleAlert className="size-4" aria-hidden /> No feasible schedule. The optimiser will not bend a limit to make one.
              </p>
              <ul className="list-disc pl-5 text-ink-2">
                {result.blocking.slice(0, 3).map((b) => (
                  <li key={b.constraint}>
                    <b className="text-ink">{b.constraint}:</b> {b.detail}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  display,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  display: (v: number) => string;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-[12.5px] font-medium text-ink-2">
          {label}
        </label>
        <output htmlFor={id} className="num text-[13px] font-semibold text-ink">
          {display(value)}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-amber-mark"
        aria-valuetext={display(value)}
      />
    </div>
  );
}

function Kpi({ label, unit, before, after, digits, money }: { label: string; unit: string; before: number; after: number; digits: number; money?: boolean }) {
  const delta = before ? (after - before) / before : 0;
  return (
    <div className="min-w-0 rounded-control border border-line bg-surface-2 p-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">{label}</p>
      <p className="num mt-1 text-[20px] font-semibold leading-none text-ink" data-testid={`sim-${label.toLowerCase()}`}>
        {money ? "₹" : ""}
        {fmt(after, digits)}
        <span className="ml-1 text-[11px] font-normal text-ink-3">{unit}</span>
      </p>
      <p className="num mt-1 truncate text-[11.5px] text-ink-3">
        was {money ? "₹" : ""}
        {fmt(before, digits)} · <span className={cn("font-semibold", delta < -0.0005 ? "text-teal" : delta > 0.0005 ? "text-red" : "text-ink-3")}>{pct(delta * 100)}</span>
      </p>
    </div>
  );
}

const BAND: Record<string, string> = {
  SOLAR: "var(--band-solar)",
  PEAK: "var(--band-peak)",
};

function MiniGantt({ current, recommended, opts }: { current: ScheduleEvaluation; recommended: ScheduleEvaluation; opts: Opts }) {
  const pid = useId().replace(/:/g, "");
  const x0 = 360;
  const x1 = 1380;
  const W = 640;
  const padL = 70;
  const sx = (m: number) => padL + ((m - x0) / (x1 - x0)) * (W - padL - 6);
  const rows = [
    { label: "Current", e: current },
    { label: "Optimised", e: recommended },
  ];
  return (
    <svg viewBox={`0 0 ${W} 104`} className="mt-4 block h-auto w-full" role="img" aria-label="Heat schedule: current practice compared with the optimised plan, over the tariff windows">
      <defs>
        <pattern id={`h-${pid}`} patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(135)">
          <rect width="5" height="5" fill="var(--amber-soft)" />
          <line x1="0" y1="0" x2="0" y2="5" stroke="var(--amber-mark)" strokeWidth="2" />
        </pattern>
      </defs>
      {deckPeriods(opts.solarDiscount, opts.peakMultiplier).map((p) => (
        <rect key={p.kind} x={sx(p.startMin)} y={4} width={sx(p.endMin) - sx(p.startMin)} height={76} fill={BAND[p.kind]} />
      ))}
      <line x1={sx(opts.deadlineMin)} x2={sx(opts.deadlineMin)} y1={2} y2={82} stroke="var(--red-mark)" strokeDasharray="3 3" />
      {rows.map((row, i) => {
        const y = 14 + i * 34;
        return (
          <g key={row.label}>
            <text x={0} y={y + 13} className="fill-ink-2 text-[11px] font-medium">
              {row.label}
            </text>
            {row.e.items.map((h) => (
              <g key={h.key}>
                <rect x={sx(h.startMin)} y={y} width={Math.max(1, sx(h.meltEndMin) - sx(h.startMin) - 0.8)} height={20} rx={2} fill="var(--ink-2)" />
                {h.tapMin > h.meltEndMin ? (
                  <rect x={sx(h.meltEndMin)} y={y} width={Math.max(1, sx(h.tapMin) - sx(h.meltEndMin) - 0.8)} height={20} rx={2} fill={`url(#h-${pid})`} stroke="var(--amber-mark)" strokeWidth={0.6} />
                ) : null}
              </g>
            ))}
          </g>
        );
      })}
      {[360, 540, 720, 900, 1080, 1260].map((t) => (
        <text key={t} x={sx(t)} y={98} textAnchor="middle" className="num fill-ink-3 text-[10.5px]">
          {hhmm(t)}
        </text>
      ))}
    </svg>
  );
}
