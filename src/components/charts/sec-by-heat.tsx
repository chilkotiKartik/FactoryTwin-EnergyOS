"use client";

import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmt } from "@/lib/format";

export interface SecDatum {
  heatNo: string;
  sec: number | null;
  expectedSec: number | null;
  flagged: boolean;
  holding: number | null;
}

export function SecByHeat({ data, baselineSec }: { data: SecDatum[]; baselineSec: number | null }) {
  const vals = data.map((d) => d.sec ?? 0).filter((v) => v > 0);
  const lo = vals.length ? Math.floor((Math.min(...vals) - 30) / 20) * 20 : 0;
  return (
    <div className="h-64 w-full" role="img" aria-label="Specific energy consumption per heat, kWh per tonne">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }} barCategoryGap={3}>
          <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="2 3" />
          <XAxis dataKey="heatNo" tickLine={false} axisLine={{ stroke: "var(--line-strong)" }} tick={{ fontSize: 11, fill: "var(--ink-3)" }} interval={0} />
          <YAxis domain={[Math.max(0, lo), "auto"]} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--ink-3)" }} width={48} />
          <Tooltip
            cursor={{ fill: "var(--surface-3)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as SecDatum;
              return (
                <div className="rounded-md border border-line bg-surface px-3 py-2 text-[12px] shadow-lg">
                  <p className="font-semibold">{d.heatNo}</p>
                  <p className="num">{fmt(d.sec, 1)} kWh/t actual</p>
                  <p className="num text-ink-3">{fmt(d.expectedSec, 1)} kWh/t expected</p>
                  <p className="num text-ink-3">Holding {fmt(d.holding, 0)} min</p>
                  {d.flagged ? <p className="font-medium text-amber">Flagged: above threshold</p> : null}
                </div>
              );
            }}
          />
          {baselineSec ? <ReferenceLine y={baselineSec} stroke="var(--ink-2)" strokeDasharray="4 3" label={{ value: `Day ${fmt(baselineSec, 1)}`, position: "insideTopRight", fontSize: 10.5, fill: "var(--ink-2)" }} /> : null}
          <Bar dataKey="sec" radius={[4, 4, 0, 0]} isAnimationActive>
            {data.map((d) => (
              <Cell key={d.heatNo} fill={d.flagged ? "var(--amber-mark)" : "var(--ink-2)"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
