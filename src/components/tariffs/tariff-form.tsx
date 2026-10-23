"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createTariffAction, previewRateAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/field";

type P = { kind: "PEAK" | "SOLAR" | "OFFPEAK"; label: string; start: string; end: string; rate: string };

export function TariffForm({ initial, defaultEffective }: { initial: { name: string; normalRate: number; periods: P[] }; defaultEffective: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(initial.name);
  const [eff, setEff] = useState(defaultEffective);
  const [normal, setNormal] = useState(String(initial.normalRate));
  const [evidence, setEvidence] = useState<"ASSUMPTION" | "VERIFIED">("ASSUMPTION");
  const [source, setSource] = useState("");
  const [periods, setPeriods] = useState<P[]>(initial.periods);
  const upd = (i: number, k: keyof P, v: string) => setPeriods(periods.map((p, j) => (j === i ? { ...p, [k]: v } : p)));

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await createTariffAction({ name, effectiveFrom: eff, normalRate: Number(normal), evidence, sourceNote: source, periods: periods.map((p) => ({ ...p, rate: Number(p.rate) })) });
          if (!r.ok) return void toast.error(r.message);
          toast.success("New tariff version saved. Pending recommendations were marked stale.");
          router.refresh();
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-2 sm:col-span-1">
          Name
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-2">
          Effective from (factory time)
          <Input type="datetime-local" value={eff} onChange={(e) => setEff(e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-2">
          Normal rate ₹/kWh
          <Input inputMode="decimal" value={normal} onChange={(e) => setNormal(e.target.value)} required />
        </label>
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-3">Time-of-day windows (outside them the normal rate applies)</p>
          <Button type="button" size="sm" variant="ghost" onClick={() => setPeriods([...periods, { kind: "OFFPEAK", label: "Night", start: "22:00", end: "06:00", rate: normal }])}>
            <Plus /> Add window
          </Button>
        </div>
        <ul className="flex flex-col gap-2">
          {periods.map((p, i) => (
            <li key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-[120px_minmax(0,1fr)_90px_90px_90px_36px]">
              <Select value={p.kind} onChange={(e) => upd(i, "kind", e.target.value)} aria-label="Window type">
                <option value="SOLAR">Solar</option>
                <option value="PEAK">Peak</option>
                <option value="OFFPEAK">Off-peak</option>
              </Select>
              <Input value={p.label} onChange={(e) => upd(i, "label", e.target.value)} aria-label="Window label" />
              <Input value={p.start} onChange={(e) => upd(i, "start", e.target.value)} aria-label="Start HH:MM" />
              <Input value={p.end} onChange={(e) => upd(i, "end", e.target.value)} aria-label="End HH:MM" />
              <Input value={p.rate} onChange={(e) => upd(i, "rate", e.target.value)} aria-label="Rate ₹/kWh" />
              <Button type="button" variant="ghost" size="icon" aria-label="Remove window" onClick={() => setPeriods(periods.filter((_, j) => j !== i))}>
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
        <p className="mt-1 text-[12px] text-ink-3">Windows may cross midnight (e.g. 22:00–06:00) but must not overlap. End is exclusive.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-[200px_minmax(0,1fr)]">
        <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-2">
          Evidence
          <Select value={evidence} onChange={(e) => setEvidence(e.target.value as typeof evidence)}>
            <option value="ASSUMPTION">Assumption</option>
            <option value="VERIFIED">Verified (source required)</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-2">
          Source (tariff order, clause, URL)
          <Textarea value={source} onChange={(e) => setSource(e.target.value)} className="min-h-9" placeholder="e.g. MERC tariff order Case No. …, HT-I industrial ToD clause" />
        </label>
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null} Save as new version
        </Button>
      </div>
    </form>
  );
}

export function RatePreview({ defaultValue }: { defaultValue: string }) {
  const [v, setV] = useState(defaultValue);
  const [res, setRes] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-2">
        Date and time (factory zone)
        <Input type="datetime-local" value={v} onChange={(e) => setV(e.target.value)} className="w-56" />
      </label>
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await previewRateAction(v);
            if (!r.ok) return void setRes(r.message ?? "Error");
            setRes(r.data ? `₹${(r.data.ratePaise / 100).toFixed(2)}/kWh · ${r.data.label} · tariff v${r.data.version}` : "No tariff version is in force at that time.");
          })
        }
      >
        Check rate
      </Button>
      {res ? (
        <p className="num basis-full text-[14px] font-medium text-ink" role="status">
          {res}
        </p>
      ) : null}
    </div>
  );
}
