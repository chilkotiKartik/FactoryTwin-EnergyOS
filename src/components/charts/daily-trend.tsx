"use client";

import { CartesianGrid, Line, LineChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmt } from "@/lib/format";

export function DailyTrend({ data, highlight }: { data: { day: string; sec: number | null; holdingMinutes: number; tonnes: number }[]; highlight: string | null }) {
  const pts = data.filter((d) => d.sec !== null);
  const h = pts.find((d) => d.day === highlight);
  return (
    <div className="h-56 w-full" role="img" aria-label="Daily specific energy consumption, kWh per tonne">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={pts} margin={{ top: 10, right: 12, bottom: 0, left: -12 }}>
          <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="2 3" />
          <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(5)} tickLine={false} axisLine={{ stroke: "var(--line-strong)" }} tick={{ fontSize: 11, fill: "var(--ink-3)" }} minTickGap={24} />
          <YAxis domain={["dataMin - 10", "dataMax + 10"]} tickFormatter={(v: number) => fmt(v, 0)} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--ink-3)" }} width={48} />
          <Tooltip
            cursor={{ stroke: "var(--ink-3)", strokeDasharray: "3 3" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as (typeof pts)[number];
              return (
                <div className="rounded-md border border-line bg-surface px-3 py-2 text-[12px] shadow-lg">
                  <p className="num font-semibold">{d.day}</p>
                  <p className="num">{fmt(d.sec, 1)} kWh/t</p>
                  <p className="num text-ink-3">
                    {fmt(d.tonnes, 1)} t · holding {fmt(d.holdingMinutes, 0)} min
                  </p>
                </div>
              );
            }}
          />
          <Line type="monotone" dataKey="sec" stroke="var(--blue)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive />
          {h ? <ReferenceDot x={h.day} y={h.sec!} r={5} fill="var(--amber-mark)" stroke="var(--surface)" strokeWidth={2} /> : null}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
