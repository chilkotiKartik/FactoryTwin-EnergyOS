"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { updatePlanAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { hhmm } from "@/lib/format";

function toMin(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v);
  if (!m) return null;
  const n = Number(m[1]) * 60 + Number(m[2]);
  return n >= 0 && n <= 1440 ? n : null;
}

export interface PlanEditorProps {
  planId: string;
  revision: number;
  deadlineMin: number;
  startMin: number;
  downtime: { fromMin: number; toMin: number; reason: string }[];
  orders: { id: string; code: string; grade: string; requiredTonnes: number; dueMin: number; heats: number; heatTonnes: number }[];
  mould: { mouldSet: number; heatNo: string; readyMin: number | null }[];
  canEdit: boolean;
}

/** Edit the optimiser's inputs. Saving bumps the plan revision and makes pending recommendations stale. */
export function PlanEditor(p: PlanEditorProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [deadline, setDeadline] = useState(hhmm(p.deadlineMin));
  const [startT, setStartT] = useState(hhmm(p.startMin));
  const [downtime, setDowntime] = useState(p.downtime.map((d) => ({ from: hhmm(d.fromMin), to: hhmm(d.toMin), reason: d.reason })));
  const [orders, setOrders] = useState(p.orders.map((o) => ({ id: o.id, tonnes: String(o.requiredTonnes), due: hhmm(o.dueMin) })));
  const [mould, setMould] = useState(p.mould.map((m) => ({ set: m.mouldSet, heatNo: m.heatNo, ready: m.readyMin === null ? "" : hhmm(m.readyMin) })));
  const [dirty, setDirty] = useState(false);
  const touch = () => setDirty(true);
  const dis = !p.canEdit || pending;

  function save() {
    const dl = toMin(deadline);
    const st = toMin(startT);
    if (dl === null || st === null) return toast.error("Use HH:MM for deadline and start.");
    const dt = downtime.map((d) => ({ fromMin: toMin(d.from), toMin: toMin(d.to), reason: d.reason.trim() }));
    if (dt.some((d) => d.fromMin === null || d.toMin === null || !d.reason)) return toast.error("Each downtime block needs a start, end and reason.");
    const os = orders.map((o) => ({ id: o.id, requiredTonnes: Number(o.tonnes), dueMin: toMin(o.due) }));
    if (os.some((o) => !Number.isFinite(o.requiredTonnes) || o.requiredTonnes <= 0 || o.dueMin === null)) return toast.error("Orders need positive tonnes and an HH:MM due time.");
    const ms = mould.map((m) => ({ mouldSet: m.set, readyMin: m.ready === "" ? null : toMin(m.ready) }));
    if (mould.some((m, i) => m.ready !== "" && ms[i].readyMin === null)) return toast.error("Mould-ready times must be HH:MM.");
    start(async () => {
      const r = await updatePlanAction({ planId: p.planId, expectedRevision: p.revision, deadlineMin: dl, currentPracticeStartMin: st, downtime: dt, orders: os, mould: ms });
      if (!r.ok) return void toast.error(r.message);
      toast.success("Plan saved. Earlier recommendations for this plan are now stale; re-run the optimiser.");
      setDirty(false);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-2">
          Dispatch deadline
          <Input value={deadline} disabled={dis} onChange={(e) => (setDeadline(e.target.value), touch())} aria-label="Dispatch deadline HH:MM" />
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-2">
          Current practice start
          <Input value={startT} disabled={dis} onChange={(e) => (setStartT(e.target.value), touch())} aria-label="Current practice start HH:MM" />
        </label>
      </div>

      <div>
        <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-3">Orders (production that must be preserved)</p>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-ink-3">
              <th className="pb-1 font-semibold">Order</th>
              <th className="pb-1 font-semibold">Heats</th>
              <th className="pb-1 font-semibold">Required t</th>
              <th className="pb-1 font-semibold">Due</th>
            </tr>
          </thead>
          <tbody>
            {p.orders.map((o, i) => (
              <tr key={o.id} className="border-t border-line">
                <td className="py-1.5 pr-2">
                  <span className="block font-medium">{o.code}</span>
                  <span className="block text-[11px] text-ink-3">{o.grade}</span>
                </td>
                <td className="num py-1.5 pr-2 text-ink-2">
                  {o.heats} <span className="text-[11px] text-ink-3">({o.heatTonnes.toFixed(2)} t)</span>
                </td>
                <td className="py-1.5 pr-2">
                  <Input value={orders[i].tonnes} disabled={dis} className="h-8 w-16" aria-label={`Required tonnes for ${o.code}`} onChange={(e) => (setOrders(orders.map((x, j) => (j === i ? { ...x, tonnes: e.target.value } : x))), touch())} />
                </td>
                <td className="py-1.5">
                  <Input value={orders[i].due} disabled={dis} className="h-8 w-20" aria-label={`Due time for ${o.code}`} onChange={(e) => (setOrders(orders.map((x, j) => (j === i ? { ...x, due: e.target.value } : x))), touch())} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-3">Planned downtime (no melting or holding)</p>
          {p.canEdit ? (
            <Button type="button" variant="ghost" size="sm" disabled={dis} onClick={() => (setDowntime([...downtime, { from: "12:00", to: "13:00", reason: "Maintenance" }]), touch())}>
              <Plus /> Add
            </Button>
          ) : null}
        </div>
        {downtime.length === 0 ? <p className="text-[13px] text-ink-3">None.</p> : null}
        <ul className="flex flex-col gap-2">
          {downtime.map((d, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2">
              <Input value={d.from} disabled={dis} className="h-8 w-20" aria-label="Downtime start" onChange={(e) => (setDowntime(downtime.map((x, j) => (j === i ? { ...x, from: e.target.value } : x))), touch())} />
              <span className="text-ink-3">to</span>
              <Input value={d.to} disabled={dis} className="h-8 w-20" aria-label="Downtime end" onChange={(e) => (setDowntime(downtime.map((x, j) => (j === i ? { ...x, to: e.target.value } : x))), touch())} />
              <Input value={d.reason} disabled={dis} className="h-8 min-w-0 flex-1" aria-label="Downtime reason" onChange={(e) => (setDowntime(downtime.map((x, j) => (j === i ? { ...x, reason: e.target.value } : x))), touch())} />
              {p.canEdit ? (
                <Button type="button" variant="ghost" size="icon" aria-label="Remove downtime" disabled={dis} onClick={() => (setDowntime(downtime.filter((_, j) => j !== i)), touch())}>
                  <Trash2 />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-3">Mould readiness plan</p>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {mould.map((m, i) => (
            <label key={m.set} className="flex flex-col gap-0.5 text-[11px] text-ink-3">
              Set {m.set} · {m.heatNo}
              <Input value={m.ready} disabled={dis} placeholder="HH:MM" className="h-8" onChange={(e) => (setMould(mould.map((x, j) => (j === i ? { ...x, ready: e.target.value } : x))), touch())} />
            </label>
          ))}
        </div>
      </div>

      {p.canEdit ? (
        <div className="flex items-center justify-end gap-3 border-t border-line pt-4">
          {dirty ? <span className="text-[12px] text-amber">Unsaved changes</span> : null}
          <Button type="button" variant="secondary" disabled={!dirty || pending} onClick={save}>
            {pending ? <Loader2 className="animate-spin" /> : null} Save plan inputs
          </Button>
        </div>
      ) : (
        <p className="text-[12px] text-ink-3">Your role can view the plan but not change it.</p>
      )}
    </div>
  );
}
