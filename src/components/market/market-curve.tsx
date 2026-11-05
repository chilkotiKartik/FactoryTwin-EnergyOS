"use client";

import { Area, AreaChart, CartesianGrid, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmt, hhmm } from "@/lib/format";

export interface CurvePoint {
  m: number;
  rs: number;
  mw: number;
}

/** 96 fifteen-minute exchange prices for one delivery day, ₹/kWh, with the cheapest and dearest windows shaded. */
export function MarketCurve({ points, cheapest, dearest, solar }: { points: CurvePoint[]; cheapest: { startMin: number; endMin: number }; dearest: { startMin: number; endMin: number }; solar: { startMin: number; endMin: number } | null }) {
  return (
    <div className="h-52 w-full" role="img" aria-label="Exchange price for each 15-minute block of the delivery day, rupees per kWh">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="2 3" />
          {solar ? <ReferenceArea x1={solar.startMin} x2={solar.endMin} fill="var(--band-solar)" fillOpacity={1} ifOverflow="hidden" /> : null}
          <ReferenceArea x1={cheapest.startMin} x2={cheapest.endMin} fill="var(--teal-soft)" fillOpacity={0.9} stroke="var(--teal)" strokeOpacity={0.5} />
          <ReferenceArea x1={dearest.startMin} x2={dearest.endMin} fill="var(--red-soft)" fillOpacity={0.9} stroke="var(--red)" strokeOpacity={0.4} />
          <XAxis dataKey="m" type="number" domain={[0, 1440]} ticks={[0, 240, 480, 720, 960, 1200, 1440]} tickFormatter={(m: number) => hhmm(m % 1440)} tickLine={false} axisLine={{ stroke: "var(--line-strong)" }} tick={{ fontSize: 11, fill: "var(--ink-3)" }} />
          <YAxis tickFormatter={(v: number) => `₹${fmt(v, 0)}`} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--ink-3)" }} width={48} domain={[0, "dataMax + 1"]} />
          <Tooltip
            cursor={{ stroke: "var(--ink-3)", strokeDasharray: "3 3" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as CurvePoint;
              return (
                <div className="rounded-md border border-line bg-surface px-3 py-2 text-[12px] shadow-lg">
                  <p className="num font-semibold">
                    {hhmm(d.m)}–{hhmm((d.m + 15) % 1440)}
                  </p>
                  <p className="num">₹{fmt(d.rs, 2)}/kWh</p>
                  <p className="num text-ink-3">{fmt(d.mw, 0)} MW cleared</p>
                </div>
              );
            }}
          />
          <Area type="stepAfter" dataKey="rs" stroke="var(--brand-1)" strokeWidth={2} fill="var(--brand-1)" fillOpacity={0.12} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
