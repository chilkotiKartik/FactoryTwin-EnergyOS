"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Copy, KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { issueIngestTokenAction, revokeIngestTokenAction, updateSettingsAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { hhmm } from "@/lib/format";

export interface SettingsValues {
  holdingKw: number;
  emissionFactor: number;
  emissionFactorSource: string;
  turnaroundMinutes: number;
  coldGapMinutes: number;
  coldExtraMinutes: number;
  maxHoldMinutes: number;
  minCompletenessPct: number;
  gridMinutes: number;
  capacityKg: number;
  ratedKw: number;
  nominalMeltMinutes: number;
  availableFromMin: number;
  availableToMin: number;
  maxHeatsPerDay: number;
}

const FIELDS: { k: keyof SettingsValues; label: string; unit: string }[] = [
  { k: "capacityKg", label: "Furnace capacity", unit: "kg" },
  { k: "ratedKw", label: "Rated power", unit: "kW" },
  { k: "nominalMeltMinutes", label: "Melt time, warm charge", unit: "min" },
  { k: "coldExtraMinutes", label: "Extra melt after cold start", unit: "min" },
  { k: "coldGapMinutes", label: "Idle gap counted as cold", unit: "min" },
  { k: "turnaroundMinutes", label: "Turnaround between heats", unit: "min" },
  { k: "holdingKw", label: "Holding power", unit: "kW" },
  { k: "maxHoldMinutes", label: "Max holding (safety/quality)", unit: "min" },
  { k: "maxHeatsPerDay", label: "Max heats per day", unit: "" },
  { k: "minCompletenessPct", label: "Min meter completeness for advice", unit: "%" },
  { k: "emissionFactor", label: "Grid emission factor", unit: "kg CO₂/kWh" },
];

export function SettingsForm({ initial, canEdit }: { initial: SettingsValues; canEdit: boolean }) {
  const router = useRouter();
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(initial).map(([k, x]) => [k, String(x)])));
  const [from, setFrom] = useState(hhmm(initial.availableFromMin));
  const [to, setTo] = useState(initial.availableToMin === 1440 ? "24:00" : hhmm(initial.availableToMin));
  const [pending, start] = useTransition();
  const m = (s: string) => {
    const [h, mi] = s.split(":").map(Number);
    return h * 60 + mi;
  };
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const payload = { ...Object.fromEntries(FIELDS.map((f) => [f.k, Number(v[f.k])])), gridMinutes: Number(v.gridMinutes), emissionFactorSource: v.emissionFactorSource, availableFromMin: m(from), availableToMin: m(to) };
        start(async () => {
          const r = await updateSettingsAction(payload);
          if (!r.ok) return void toast.error(r.message);
          toast.success("Settings saved. Re-run analysis and the optimiser to use them.");
          router.refresh();
        });
      }}
    >
      <fieldset disabled={!canEdit || pending} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {FIELDS.map((f) => (
          <label key={f.k} className="flex flex-col gap-1 text-[12px] font-medium text-ink-2">
            {f.label} {f.unit ? <span className="font-normal text-ink-3">({f.unit})</span> : null}
            <Input inputMode="decimal" value={v[f.k]} onChange={(e) => setV({ ...v, [f.k]: e.target.value })} />
          </label>
        ))}
        <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-2">
          Start-time grid
          <Select value={v.gridMinutes} onChange={(e) => setV({ ...v, gridMinutes: e.target.value })}>
            {[1, 5, 10, 15].map((g) => (
              <option key={g} value={g}>
                {g} min
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-2">
          Furnace available from
          <Input value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-2">
          Furnace available until
          <Input value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-2 sm:col-span-2 lg:col-span-3">
          Emission factor source
          <Input value={v.emissionFactorSource} onChange={(e) => setV({ ...v, emissionFactorSource: e.target.value })} />
        </label>
      </fieldset>
      {canEdit ? (
        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : null} Save settings
          </Button>
        </div>
      ) : (
        <p className="text-[12px] text-ink-3">Only an owner can change factory settings.</p>
      )}
    </form>
  );
}

export function IngestToken({ meterId, hasToken }: { meterId: string; hasToken: boolean }) {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="secondary"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await issueIngestTokenAction(meterId);
            if (!r.ok || !r.data) return void toast.error(r.message ?? "Could not issue a token.");
            setToken(r.data.token);
          })
        }
      >
        <KeyRound /> {hasToken ? "Rotate token" : "Issue ingest token"}
      </Button>
      {hasToken ? (
        <Button
          variant="ghost"
          size="sm"
          className="text-red"
          disabled={pending}
          onClick={() =>
            start(async () => {
              if (!confirm("Revoke this meter's token? The meter stops being able to send readings.")) return;
              const r = await revokeIngestTokenAction(meterId);
              if (!r.ok) return void toast.error(r.message ?? "Could not revoke.");
              setToken(null);
              toast.success("Token revoked.");
              router.refresh();
            })
          }
        >
          Revoke token
        </Button>
      ) : null}
      {token ? (
        <div className="rounded-md border border-amber/30 bg-amber-soft p-2 text-[12px]">
          <p className="mb-1 font-medium text-amber">Copy this token now. It is shown once and stored only as a hash. Any previous token stops working.</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all font-mono">{token}</code>
            <Button size="icon" variant="ghost" aria-label="Copy token" onClick={() => void navigator.clipboard.writeText(token).then(() => toast.success("Copied."))}>
              <Copy />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
