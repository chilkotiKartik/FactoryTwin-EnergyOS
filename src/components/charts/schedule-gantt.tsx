"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";
import { fmt, hhmm } from "@/lib/format";

export interface GanttItem {
  label: string;
  startMin: number;
  meltEndMin: number;
  tapMin: number;
  holdMin: number;
  mouldReadyMin: number | null;
  cold: boolean;
  meltKwh?: number;
  holdKwh?: number;
  costPaise?: number;
}

export interface GanttRow {
  key: string;
  label: string;
  sublabel?: string;
  items: GanttItem[];
  tone?: "current" | "recommended";
}

const BAND_FILL: Record<string, string> = {
  SOLAR: "var(--band-solar)",
  PEAK: "var(--band-peak)",
  OFFPEAK: "var(--band-offpeak)",
};

export function ScheduleGantt({
  rows,
  tariffBands,
  deadlineMin,
  downtime = [],
  fromMin = 330,
  toMin = 1350,
  ariaLabel,
}: {
  rows: GanttRow[];
  tariffBands: {
    startMin: number;
    endMin: number;
    kind: string;
    label: string;
    ratePaise: number;
  }[];
  deadlineMin?: number | null;
  downtime?: { fromMin: number; toMin: number; reason: string }[];
  fromMin?: number;
  toMin?: number;
  ariaLabel: string;
}) {
  const pid = useId().replace(/:/g, "");
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  const reduce = useReducedMotion();
  const [tip, setTip] = useState<{
    x: number;
    y: number;
    row: string;
    it: GanttItem;
  } | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) =>
      setWidth(Math.max(320, Math.round(e.contentRect.width))),
    );
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  const labelW = width < 560 ? 92 : 150;
  const padR = 8;
  const rowH = 46;
  const top = 22;
  const height = top + rows.length * rowH + 26;
  const innerW = width - labelW - padR;
  const sx = (m: number) =>
    labelW +
    ((Math.min(Math.max(m, fromMin), toMin) - fromMin) / (toMin - fromMin)) *
      innerW;
  const ticks: number[] = [];
  const step = innerW < 500 ? 180 : 120;
  for (let t = Math.ceil(fromMin / step) * step; t <= toMin; t += step)
    ticks.push(t);

  return (
    <div ref={ref} className="relative w-full overflow-x-clip">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={ariaLabel}
        className="block"
      >
        <defs>
          <pattern
            id={`h-${pid}`}
            patternUnits="userSpaceOnUse"
            width="6"
            height="6"
            patternTransform="rotate(135)"
          >
            <rect width="6" height="6" fill="var(--amber-soft)" />
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="6"
              stroke="var(--amber-mark)"
              strokeWidth="2.2"
            />
          </pattern>
          <pattern
            id={`d-${pid}`}
            patternUnits="userSpaceOnUse"
            width="6"
            height="6"
            patternTransform="rotate(45)"
          >
            <rect width="6" height="6" fill="var(--surface-3)" />
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="6"
              stroke="var(--ink-3)"
              strokeWidth="1.2"
            />
          </pattern>
        </defs>
        {tariffBands
          .filter(
            (b) =>
              b.kind !== "NORMAL" && b.endMin > fromMin && b.startMin < toMin,
          )
          .map((b) => (
            <g key={`${b.startMin}`}>
              <rect
                x={sx(Math.max(b.startMin, fromMin))}
                y={top}
                width={
                  sx(Math.min(b.endMin, toMin)) -
                  sx(Math.max(b.startMin, fromMin))
                }
                height={rows.length * rowH}
                fill={BAND_FILL[b.kind]}
              />
              {width >= 560 ? (
                <text
                  {...(sx(toMin) - sx(Math.max(b.startMin, fromMin)) < 150
                    ? {
                        x: sx(Math.min(b.endMin, toMin)) - 4,
                        textAnchor: "end" as const,
                      }
                    : { x: sx(Math.max(b.startMin, fromMin)) + 4 })}
                  y={top - 7}
                  className="fill-ink-3 text-[10.5px]"
                >
                  {b.label} ₹{(b.ratePaise / 100).toFixed(2)}
                </text>
              ) : null}
            </g>
          ))}
        {downtime.map((d) => (
          <g key={d.fromMin}>
            <rect
              x={sx(d.fromMin)}
              y={top}
              width={sx(d.toMin) - sx(d.fromMin)}
              height={rows.length * rowH}
              fill={`url(#d-${pid})`}
              opacity={0.8}
            />
            <text
              x={sx(d.fromMin) + 3}
              y={top + rows.length * rowH - 4}
              className="fill-ink-2 text-[10px] font-semibold"
            >
              {d.reason}
            </text>
          </g>
        ))}
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={sx(t)}
              x2={sx(t)}
              y1={top}
              y2={top + rows.length * rowH}
              stroke="var(--line-strong)"
              strokeDasharray="2 3"
            />
            <text
              x={sx(t)}
              y={height - 6}
              textAnchor="middle"
              className="num fill-ink-3 text-[10.5px]"
            >
              {hhmm(t)}
            </text>
          </g>
        ))}
        {rows.map((r, ri) => {
          const y = top + ri * rowH;
          return (
            <g key={r.key}>
              <line
                x1={0}
                x2={width}
                y1={y + rowH}
                y2={y + rowH}
                stroke="var(--line)"
              />
              <text
                x={4}
                y={y + 20}
                className="fill-ink text-[12px] font-semibold"
              >
                {r.label}
              </text>
              {r.sublabel ? (
                <text x={4} y={y + 35} className="num fill-ink-3 text-[10.5px]">
                  {r.sublabel}
                </text>
              ) : null}
              {r.items.map((it, i) => {
                const xa = sx(it.startMin);
                const xm = sx(it.meltEndMin);
                const xb = sx(it.tapMin);
                return (
                  <motion.g
                    key={`${r.key}-${it.label}`}
                    initial={reduce ? false : { opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: 0.25,
                      delay: reduce ? 0 : i * 0.025,
                    }}
                    onPointerEnter={(e) => {
                      const box = ref.current!.getBoundingClientRect();
                      setTip({
                        x: e.clientX - box.left,
                        y: y + rowH,
                        row: r.label,
                        it,
                      });
                    }}
                    onPointerLeave={() => setTip(null)}
                    tabIndex={0}
                    onFocus={() =>
                      setTip({ x: xa, y: y + rowH, row: r.label, it })
                    }
                    onBlur={() => setTip(null)}
                    aria-label={`${r.label} ${it.label}: start ${hhmm(it.startMin)}, tap ${hhmm(it.tapMin)}, holding ${it.holdMin} min`}
                    className="focus:outline-none"
                  >
                    <rect
                      x={xa}
                      y={y + 9}
                      width={Math.max(1.5, xm - xa - 1)}
                      height={rowH - 18}
                      rx={2}
                      fill={
                        r.tone === "recommended"
                          ? "var(--teal)"
                          : "var(--ink-2)"
                      }
                    />
                    {it.holdMin > 0 ? (
                      <rect
                        x={xm}
                        y={y + 9}
                        width={Math.max(1.5, xb - xm - 1)}
                        height={rowH - 18}
                        rx={2}
                        fill={`url(#h-${pid})`}
                        stroke="var(--amber-mark)"
                        strokeWidth={0.8}
                      />
                    ) : null}
                    {it.mouldReadyMin !== null ? (
                      <line
                        x1={sx(it.mouldReadyMin)}
                        x2={sx(it.mouldReadyMin)}
                        y1={y + 5}
                        y2={y + rowH - 5}
                        stroke="var(--teal-mark)"
                        strokeWidth={1.5}
                        strokeDasharray="2 2"
                      />
                    ) : null}
                  </motion.g>
                );
              })}
            </g>
          );
        })}
        {deadlineMin !== null &&
        deadlineMin !== undefined &&
        deadlineMin <= toMin ? (
          <g>
            <line
              x1={sx(deadlineMin)}
              x2={sx(deadlineMin)}
              y1={top - 4}
              y2={top + rows.length * rowH}
              stroke="var(--red)"
              strokeWidth={1.5}
            />
            <text
              x={sx(deadlineMin) - 3}
              y={top + 10}
              textAnchor="end"
              className="fill-red text-[10.5px] font-semibold"
            >
              Deadline {hhmm(deadlineMin)}
            </text>
          </g>
        ) : null}
      </svg>
      {tip ? (
        <div
          className="pointer-events-none absolute z-10 w-52 rounded-md border border-line bg-surface px-3 py-2 text-[12px] shadow-lg"
          style={{ left: Math.min(tip.x + 10, width - 215), top: tip.y }}
        >
          <p className="font-semibold">
            {tip.row} · {tip.it.label}
            {tip.it.cold ? " (cold start)" : ""}
          </p>
          <p className="num text-ink-2">
            Melt {hhmm(tip.it.startMin)}–{hhmm(tip.it.meltEndMin)} · tap{" "}
            {hhmm(tip.it.tapMin)}
          </p>
          <p className="num text-ink-2">
            Mould ready {hhmm(tip.it.mouldReadyMin)}
          </p>
          <p
            className={`num ${tip.it.holdMin > 0 ? "font-medium text-amber" : "text-ink-3"}`}
          >
            Holding {tip.it.holdMin} min
          </p>
          {tip.it.meltKwh !== undefined ? (
            <p className="num text-ink-3">
              {fmt((tip.it.meltKwh ?? 0) + (tip.it.holdKwh ?? 0), 0)} kWh · ₹
              {fmt((tip.it.costPaise ?? 0) / 100, 0)} (modelled)
            </p>
          ) : null}
        </div>
      ) : null}
      <ul
        className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-ink-3"
        aria-label="Legend"
      >
        <li className="flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-sm bg-ink-2" aria-hidden />{" "}
          Melting, current practice
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-sm bg-teal" aria-hidden /> Melting,
          recommended
        </li>
        <li className="flex items-center gap-1.5">
          <span
            className="hatch-amber h-2.5 w-4 rounded-sm border border-amber-mark"
            aria-hidden
          />{" "}
          Holding
        </li>
        <li className="flex items-center gap-1.5">
          <span
            className="h-3 w-0 border-l-2 border-dashed border-teal-mark"
            aria-hidden
          />{" "}
          Mould ready
        </li>
        <li className="flex items-center gap-1.5">
          <span
            className="h-2.5 w-4 rounded-sm"
            style={{ background: "var(--band-solar)" }}
            aria-hidden
          />{" "}
          Solar ₹/kWh window
        </li>
        <li className="flex items-center gap-1.5">
          <span
            className="h-2.5 w-4 rounded-sm"
            style={{ background: "var(--band-peak)" }}
            aria-hidden
          />{" "}
          Peak window
        </li>
      </ul>
    </div>
  );
}
