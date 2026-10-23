import { CheckCircle2, XCircle } from "lucide-react";
import { ScheduleGantt, type GanttItem } from "@/components/charts/schedule-gantt";
import { Table, Td, Th } from "@/components/ui/table";
import { Evidence } from "@/components/ui/badge";
import { fmt, hhmm, inr, pct, signed } from "@/lib/format";
import { cn } from "@/lib/cn";

export interface ItemLike {
  label?: string;
  heatNo?: string;
  startMin: number;
  meltEndMin: number;
  tapMin: number;
  holdMin: number;
  mouldReadyMin: number | null;
  cold: boolean;
  meltKwh: number;
  holdKwh: number;
  costPaise: number;
  pouredKg?: number;
}

export const toGantt = (items: ItemLike[]): GanttItem[] =>
  items.map((i) => ({ label: i.label ?? i.heatNo ?? "?", startMin: i.startMin, meltEndMin: i.meltEndMin, tapMin: i.tapMin, holdMin: i.holdMin, mouldReadyMin: i.mouldReadyMin, cold: i.cold, meltKwh: i.meltKwh, holdKwh: i.holdKwh, costPaise: i.costPaise }));

type Band = { startMin: number; endMin: number; kind: string; label: string; ratePaise: number };

export function ScheduleCompare({
  current,
  recommended,
  recommendedLabel = "Recommended",
  bands,
  deadlineMin,
  downtime,
}: {
  current: ItemLike[];
  recommended: ItemLike[] | null;
  recommendedLabel?: string;
  bands: Band[];
  deadlineMin: number;
  downtime: { fromMin: number; toMin: number; reason: string }[];
}) {
  const all = [...current, ...(recommended ?? [])];
  const from = Math.max(0, Math.floor((Math.min(...all.map((i) => Math.min(i.startMin, i.mouldReadyMin ?? 1440)), 360) - 30) / 60) * 60);
  const to = Math.min(1440, Math.ceil((Math.max(...all.map((i) => i.tapMin), deadlineMin) + 30) / 60) * 60);
  return (
    <ScheduleGantt
      rows={[
        { key: "cur", label: "Current practice", sublabel: `${current.length} heats`, items: toGantt(current), tone: "current" },
        ...(recommended ? [{ key: "rec", label: recommendedLabel, sublabel: `${recommended.length} heats`, items: toGantt(recommended), tone: "recommended" as const }] : []),
      ]}
      tariffBands={bands}
      deadlineMin={deadlineMin}
      downtime={downtime}
      fromMin={from}
      toMin={to}
      ariaLabel="Furnace schedule: current practice compared with the recommended schedule, over tariff windows"
    />
  );
}

export function ChecksList({ checks }: { checks: { id: string; label: string; status: "PASS" | "FAIL"; detail: string }[] }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {checks.map((c) => (
        <li key={c.id} className={cn("flex items-start gap-2 rounded-md border px-3 py-2", c.status === "PASS" ? "border-line" : "border-red/30 bg-red-soft")}>
          {c.status === "PASS" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-teal" aria-label="Pass" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-red" aria-label="Fail" />}
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-ink">{c.label}</p>
            <p className="text-[12px] text-ink-3">{c.detail}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ScheduleTable({ current, recommended }: { current: ItemLike[]; recommended: ItemLike[] }) {
  return (
    <Table className="[&_td]:px-2 [&_th]:px-2">
      <thead>
        <tr>
          <Th>Heat</Th>
          <Th align="right">Mould ready</Th>
          <Th align="right">Start (now → rec.)</Th>
          <Th align="right">Tap (now → rec.)</Th>
          <Th align="right">Hold min</Th>
          <Th align="right">kWh</Th>
          <Th align="right">Cost</Th>
        </tr>
      </thead>
      <tbody>
        {recommended.map((r, i) => {
          const c = current[i];
          const moved = c && c.startMin !== r.startMin;
          return (
            <tr key={i}>
              <Td className="font-medium">
                {r.label ?? r.heatNo}
                {r.cold ? <span className="ml-1.5 text-[11px] font-normal text-blue">cold start</span> : null}
              </Td>
              <Td align="right">{hhmm(r.mouldReadyMin)}</Td>
              <Td align="right">
                <span className="text-ink-3">{hhmm(c?.startMin)}</span> → <span className={moved ? "font-semibold" : ""}>{hhmm(r.startMin)}</span>
              </Td>
              <Td align="right">
                <span className="text-ink-3">{hhmm(c?.tapMin)}</span> → {hhmm(r.tapMin)}
              </Td>
              <Td align="right">
                <span className="text-ink-3">{fmt(c?.holdMin)}</span> → <span className={r.holdMin > 0 ? "text-amber" : ""}>{fmt(r.holdMin)}</span>
              </Td>
              <Td align="right">
                <span className="text-ink-3">{fmt(c ? c.meltKwh + c.holdKwh : null, 1)}</span> → {fmt(r.meltKwh + r.holdKwh, 1)}
              </Td>
              <Td align="right">
                <span className="text-ink-3">{inr(c?.costPaise)}</span> → {inr(r.costPaise)}
              </Td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

export interface Predicted {
  label: string;
  current: { kwh: number; costPaise: number; holdMinutes: number; tonnes: number; sec: number | null; costPerTonnePaise: number | null; firstStartMin: number | null; lastTapMin: number | null };
  recommended: Predicted["current"];
  delta: { kwh: number; kwhPct: number | null; costPaise: number; costPct: number | null; holdMinutes: number; tonnes: number };
}

/** Before/after table for a modelled prediction. Never presented as an achieved saving. */
export function PredictedTable({ p }: { p: Predicted }) {
  const rows: [string, string, string, string][] = [
    ["Energy", `${fmt(p.current.kwh, 0)} kWh`, `${fmt(p.recommended.kwh, 0)} kWh`, `${signed(p.delta.kwh, 0)} kWh (${pct(p.delta.kwhPct)})`],
    ["Specific energy", `${fmt(p.current.sec, 1)} kWh/t`, `${fmt(p.recommended.sec, 1)} kWh/t`, pct(p.current.sec && p.recommended.sec ? (100 * (p.recommended.sec - p.current.sec)) / p.current.sec : null)],
    ["Energy cost", inr(p.current.costPaise), inr(p.recommended.costPaise), `${p.delta.costPaise < 0 ? "−" : "+"}${inr(Math.abs(p.delta.costPaise))} (${pct(p.delta.costPct)})`],
    ["Cost per tonne", inr(p.current.costPerTonnePaise), inr(p.recommended.costPerTonnePaise), pct(p.current.costPerTonnePaise && p.recommended.costPerTonnePaise ? (100 * (p.recommended.costPerTonnePaise - p.current.costPerTonnePaise)) / p.current.costPerTonnePaise : null)],
    ["Holding time", `${fmt(p.current.holdMinutes)} min`, `${fmt(p.recommended.holdMinutes)} min`, `${signed(p.delta.holdMinutes)} min`],
    ["Tonnes poured", `${fmt(p.current.tonnes, 2)} t`, `${fmt(p.recommended.tonnes, 2)} t`, p.delta.tonnes === 0 ? "unchanged" : `${signed(p.delta.tonnes, 2)} t`],
    ["First start / last tap", `${hhmm(p.current.firstStartMin)} / ${hhmm(p.current.lastTapMin)}`, `${hhmm(p.recommended.firstStartMin)} / ${hhmm(p.recommended.lastTapMin)}`, ""],
  ];
  return (
    <div>
      <Table>
        <thead>
          <tr>
            <Th>Measure</Th>
            <Th align="right">Current practice</Th>
            <Th align="right">Recommended</Th>
            <Th align="right">Predicted change</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, a, b, d]) => (
            <tr key={k}>
              <Td className="text-ink-2">{k}</Td>
              <Td align="right">{a}</Td>
              <Td align="right">{b}</Td>
              <Td align="right" className="font-medium">
                {d}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <p className="mt-2 flex items-center gap-2 text-[12px] text-ink-3">
        <Evidence label="MODELLED" /> Prediction from the fitted energy model and the tariff in force. Not an achieved saving until an outcome is recorded and verified.
      </p>
    </div>
  );
}
