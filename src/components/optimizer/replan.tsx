"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { replanAction } from "@/app/actions";
import type { ReplanParams, ReplanView } from "@/server/services/optimization";
import { Badge } from "@/components/ui/badge";
import { fmt, hhmm, inr } from "@/lib/format";

const toMin = (v: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v);
  return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
};

/**
 * Re-plan the rest of the shift when it is running late. Poured heats stay as they ran;
 * only the remaining heats are re-optimised from now. Nothing is saved.
 */
export function Replan({ planId }: { planId: string }) {
  const [now, setNow] = useState("");
  const [busyUntil, setBusyUntil] = useState("");
  const [done, setDone] = useState<string[] | null>(null);
  const [res, setRes] = useState<ReplanView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  useEffect(() => {
    const my = ++seq.current;
    const t = setTimeout(async () => {
      setLoading(true);
      const params: ReplanParams = { nowMin: toMin(now), busyUntilMin: toMin(busyUntil) ?? null };
      if (done) params.done = done;
      const r = await replanAction(planId, params);
      if (my !== seq.current) return;
      setLoading(false);
      if (!r.ok || !r.data) return void setErr(r.message ?? "Could not re-plan.");
      setErr(null);
      setRes(r.data);
    }, 250);
    return () => clearTimeout(t);
  }, [planId, now, busyUntil, done]);

  const doneIds = done ?? res?.heats.filter((h) => h.done).map((h) => h.id) ?? [];
  const toggle = (id: string) => setDone(doneIds.includes(id) ? doneIds.filter((x) => x !== id) : [...doneIds, id]);
  const rec = res?.recommended ?? null;
  const cur = res?.current ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-2">
          Re-plan from (blank = now)
          <input type="time" value={now} onChange={(e) => setNow(e.target.value)} placeholder={res ? hhmm(res.nowMin) : ""} className="h-9 rounded-md border border-line-strong bg-surface px-3 text-sm num" />
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-2">
          Furnace busy until (optional)
          <input type="time" value={busyUntil} onChange={(e) => setBusyUntil(e.target.value)} className="h-9 rounded-md border border-line-strong bg-surface px-3 text-sm num" />
        </label>
      </div>

      {res ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[12px] font-medium text-ink-2">Heats already poured {done === null ? "(from today's heat log)" : ""}</legend>
          <div className="flex flex-wrap gap-2">
            {res.heats.map((h) => {
              const on = doneIds.includes(h.id);
              return (
                <button
                  key={h.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(h.id)}
                  className={`min-h-9 rounded-md border px-3 text-[13px] num ${on ? "border-teal bg-teal/10 text-ink" : "border-line-strong bg-surface text-ink-2"}`}
                >
                  {h.label}
                  {h.recordedTapMin !== null ? <span className="ml-1 text-ink-3">· tapped {hhmm(h.recordedTapMin)}</span> : null}
                </button>
              );
            })}
          </div>
          {done !== null ? (
            <button type="button" onClick={() => setDone(null)} className="inline-flex w-fit items-center gap-1 text-[12px] font-medium text-blue hover:underline">
              <RotateCcw className="size-3" aria-hidden /> Use the heat log again
            </button>
          ) : null}
        </fieldset>
      ) : null}

      <div className="rounded-md border border-line bg-surface-2 p-3" aria-live="polite">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold">Rest of the shift</span>
          <Badge>MODELLED · not saved</Badge>
          {res ? <span className="text-[12px] text-ink-3">furnace free from {hhmm(res.freeFromMin)}</span> : null}
          {loading ? <Loader2 className="size-3.5 animate-spin text-ink-3" aria-label="Computing" /> : null}
        </div>
        {err ? <p className="text-[13px] text-red">{err}</p> : null}
        {res?.status === "DONE" ? <p className="text-[13px] text-ink-2">Every planned heat is poured. Nothing left to schedule.</p> : null}
        {res?.status === "INFEASIBLE" ? (
          <>
            <p className="mb-1 text-[13px] font-medium text-red">The remaining heats no longer fit. Tell the dispatch planner:</p>
            <ul className="list-disc pl-5 text-[13px] text-ink-2">
              {res.blocking.slice(0, 3).map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          </>
        ) : null}
        {res && rec && cur ? (
          <>
            <dl className="mb-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-4">
              <Metric label="Carry on as usual" value={inr(cur.costPaise)} />
              <Metric label="Re-planned" value={inr(rec.costPaise)} />
              <Metric label="Saved on the rest of the day" value={inr(Math.max(0, cur.costPaise - rec.costPaise))} strong />
              <Metric label="Holding" value={`${fmt(cur.holdMinutes)} → ${fmt(rec.holdMinutes)} min`} />
              <Metric label="Last tap" value={`${hhmm(cur.lastTapMin)} → ${hhmm(rec.lastTapMin)}`} />
              {res.remainingTonnes.length ? <Metric label="Still to pour" value={res.remainingTonnes.map((o) => `${o.code} ${fmt(o.tonnes, 2)} t`).join(", ")} /> : null}
            </dl>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-[13px]">
                <thead>
                  <tr className="text-left text-[12px] text-ink-3">
                    <th className="py-1 pr-3 font-medium">Heat</th>
                    <th className="py-1 pr-3 font-medium">Start</th>
                    <th className="py-1 pr-3 font-medium">Tap</th>
                    <th className="py-1 pr-3 font-medium">Holding</th>
                    <th className="py-1 font-medium">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {res.items.map((it) => (
                    <tr key={it.label} className="border-t border-line">
                      <td className="py-1.5 pr-3 num">
                        {it.label}
                        {it.cold ? <span className="ml-1 text-[11px] text-ink-3">cold</span> : null}
                      </td>
                      <td className="py-1.5 pr-3 num">
                        {hhmm(it.startMin)}
                        {it.moved ? <span className="ml-1 text-[11px] text-amber">changed</span> : null}
                      </td>
                      <td className="py-1.5 pr-3 num">{hhmm(it.tapMin)}</td>
                      <td className="py-1.5 pr-3 num">{fmt(it.holdMin)} min</td>
                      <td className="py-1.5 num">{inr(it.costPaise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
        {res?.notes.length ? <p className="mt-2 text-[12px] text-ink-3">{res.notes.join(" ")}</p> : null}
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
