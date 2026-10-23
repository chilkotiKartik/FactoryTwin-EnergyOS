"use client";

import { useMemo, useRef, useState, useEffect, useId } from "react";
import { useRouter } from "next/navigation";
import { hhmm, fmt } from "@/lib/format";

export interface TimelineHeat {
  id: string;
  heatNo: string;
  startMin: number;
  meltEndMin: number | null;
  tapMin: number | null;
  holdingMinutes: number | null;
  flagged: boolean;
  mouldSet: number | null;
  mouldReadyMin: number | null;
}

export interface TimelineProps {
  points: { m: number; kw: number | null }[];
  heats: TimelineHeat[];
  tariffBands: { startMin: number; endMin: number; kind: string; label: string; ratePaise: number }[];
  fromMin?: number;
  toMin?: number;
  highlightHeatId?: string | null;
  /** Holding phases from the trace (minute ranges) to emphasise. */
  holdSpans?: { fromMin: number; toMin: number }[];
  height?: number;
  linkHeats?: boolean;
  ariaLabel: string;
}

const BAND_FILL: Record<string, string> = { SOLAR: "var(--band-solar)", PEAK: "var(--band-peak)", OFFPEAK: "var(--band-offpeak)" };

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(800);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/**
 * The core evidence view: 1-minute furnace power with tariff windows behind it
 * and each heat's melting and holding intervals beneath. Gaps in meter data are
 * drawn as gaps, never interpolated.
 */
export function EnergyTimeline({ points, heats, tariffBands, fromMin, toMin, highlightHeatId, holdSpans, height = 260, linkHeats = true, ariaLabel }: TimelineProps) {
  const router = useRouter();
  const pid = useId().replace(/:/g, "");
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const auto = useMemo(() => {
    const active = points.filter((p) => p.kw !== null && p.kw > 1).map((p) => p.m);
    const hs = heats.flatMap((h) => [h.startMin, h.tapMin ?? h.startMin]);
    const all = [...active, ...hs];
    if (!all.length) return { a: 300, b: 1320 };
    return { a: Math.max(0, Math.floor((Math.min(...all) - 30) / 60) * 60), b: Math.min(1440, Math.ceil((Math.max(...all) + 30) / 60) * 60) };
  }, [points, heats]);
  const x0 = fromMin ?? auto.a;
  const x1 = toMin ?? auto.b;

  const padL = 44;
  const padR = 10;
  const plotTop = 22;
  const laneH = 26;
  const plotH = height - plotTop - laneH - 30;
  const innerW = width - padL - padR;
  const maxKw = Math.max(600, ...points.map((p) => p.kw ?? 0)) * 1.05;
  const sx = (m: number) => padL + ((m - x0) / (x1 - x0)) * innerW;
  const sy = (kw: number) => plotTop + plotH - (kw / maxKw) * plotH;

  const visible = points.filter((p) => p.m >= x0 && p.m <= x1);
  const segments: string[] = [];
  let cur = "";
  for (const p of visible) {
    if (p.kw === null) {
      if (cur) segments.push(cur);
      cur = "";
      continue;
    }
    // Step shape: each reading holds its value for its minute.
    cur += `${cur ? "L" : "M"}${sx(p.m).toFixed(1)},${sy(p.kw).toFixed(1)}L${sx(p.m + 1).toFixed(1)},${sy(p.kw).toFixed(1)}`;
  }
  if (cur) segments.push(cur);
  const gaps: { a: number; b: number }[] = [];
  let gs: number | null = null;
  for (const p of visible) {
    if (p.kw === null && gs === null) gs = p.m;
    if (p.kw !== null && gs !== null) {
      gaps.push({ a: gs, b: p.m });
      gs = null;
    }
  }
  if (gs !== null) gaps.push({ a: gs, b: x1 });
  // Only show gaps that fall inside heats (missing data where production ran).
  const heatGaps = gaps.filter((g) => heats.some((h) => h.tapMin !== null && g.a < h.tapMin && h.startMin < g.b));

  const tickStep = x1 - x0 > 600 ? 120 : x1 - x0 > 240 ? 60 : 15;
  const ticks: number[] = [];
  for (let t = Math.ceil(x0 / tickStep) * tickStep; t <= x1; t += tickStep) ticks.push(t);
  const kwTicks = [0, 200, 400, 600].filter((k) => k <= maxKw);

  const laneY = plotTop + plotH + 8;
  const hoverPoint = hover !== null ? points[hover] : null;
  const hoverHeat = hover !== null ? heats.find((h) => h.tapMin !== null && hover >= h.startMin && hover < h.tapMin) : null;
  const hoverBand = hover !== null ? tariffBands.find((b) => hover >= b.startMin && hover < b.endMin) : null;
  const phase = hoverHeat ? (hoverHeat.meltEndMin !== null && hover! >= hoverHeat.meltEndMin ? "holding / waiting" : "melting") : "between heats";

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * width;
    if (px < padL || px > width - padR) return setHover(null);
    const m = Math.floor(x0 + ((px - padL) / innerW) * (x1 - x0));
    setHover(Math.max(0, Math.min(1439, m)));
  }

  return (
    <div ref={wrapRef} className="relative w-full select-none overflow-x-clip">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={ariaLabel}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        className="block touch-pan-y"
      >
        <defs>
          <pattern id={`hold-${pid}`} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(135)">
            <rect width="6" height="6" fill="var(--amber-soft)" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--amber-mark)" strokeWidth="2.2" />
          </pattern>
          <pattern id={`gap-${pid}`} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--ink-3)" strokeWidth="1" />
          </pattern>
          <clipPath id={`clip-${pid}`}>
            <rect x={padL} y={0} width={innerW} height={height} />
          </clipPath>
        </defs>

        <g clipPath={`url(#clip-${pid})`}>
          {tariffBands
            .filter((b) => b.kind !== "NORMAL" && b.endMin > x0 && b.startMin < x1)
            .map((b) => (
              <g key={`${b.startMin}-${b.kind}`}>
                <rect x={sx(Math.max(b.startMin, x0))} y={plotTop} width={sx(Math.min(b.endMin, x1)) - sx(Math.max(b.startMin, x0))} height={plotH} fill={BAND_FILL[b.kind] ?? "transparent"} />
                <text
                  {...(padL + innerW - sx(Math.max(b.startMin, x0)) < 170 ? { x: sx(Math.min(b.endMin, x1)) - 4, textAnchor: "end" as const } : { x: sx(Math.max(b.startMin, x0)) + 4 })}
                  y={plotTop - 6}
                  className="fill-ink-3 text-[10.5px]"
                >
                  {b.label} · ₹{(b.ratePaise / 100).toFixed(2)}
                </text>
              </g>
            ))}
          {highlightHeatId
            ? heats
                .filter((h) => h.id === highlightHeatId && h.tapMin !== null)
                .map((h) => <rect key="hl" x={sx(h.startMin)} y={plotTop} width={sx(h.tapMin!) - sx(h.startMin)} height={plotH} fill="var(--blue)" opacity={0.06} />)
            : null}
          {holdSpans?.map((s) => (
            <rect key={`hs-${s.fromMin}`} x={sx(s.fromMin)} y={plotTop} width={sx(s.toMin) - sx(s.fromMin)} height={plotH} fill={`url(#hold-${pid})`} opacity={0.55} />
          ))}
          {heatGaps.map((g) => (
            <g key={`gap-${g.a}`}>
              <rect x={sx(g.a)} y={plotTop} width={sx(g.b) - sx(g.a)} height={plotH} fill={`url(#gap-${pid})`} opacity={0.5} />
              <text x={sx(g.a) + 3} y={plotTop + 12} className="fill-ink-2 text-[10.5px] font-semibold">
                No data
              </text>
            </g>
          ))}
        </g>

        {kwTicks.map((k) => (
          <g key={k}>
            <line x1={padL} x2={width - padR} y1={sy(k)} y2={sy(k)} stroke="var(--line)" strokeDasharray={k === 0 ? undefined : "2 3"} />
            <text x={padL - 6} y={sy(k) + 3.5} textAnchor="end" className="num fill-ink-3 text-[10.5px]">
              {k}
            </text>
          </g>
        ))}
        <text x={4} y={plotTop - 6} className="fill-ink-3 text-[10.5px]">
          kW
        </text>

        <g clipPath={`url(#clip-${pid})`}>
          {segments.map((d, i) => (
            <path key={i} d={d} fill="none" stroke="var(--ink)" strokeWidth={1.4} strokeLinejoin="round" />
          ))}
        </g>

        {/* Heat lane */}
        <g clipPath={`url(#clip-${pid})`}>
          {heats
            .filter((h) => h.tapMin !== null && h.tapMin > x0 && h.startMin < x1)
            .map((h) => {
              const meltEnd = h.meltEndMin ?? h.tapMin!;
              const xa = sx(h.startMin);
              const xm = sx(meltEnd);
              const xb = sx(h.tapMin!);
              const isHl = highlightHeatId === h.id;
              const label = xb - xa > 26;
              const body = (
                <g>
                  <title>{`${h.heatNo}: ${hhmm(h.startMin)}–${hhmm(h.tapMin)}${h.holdingMinutes ? `, holding ${Math.round(h.holdingMinutes)} min` : ""}${h.flagged ? " (flagged)" : ""}`}</title>
                  <rect x={xa} y={laneY} width={Math.max(1, xm - xa - 1)} height={laneH - 8} rx={2} fill={isHl ? "var(--blue)" : "var(--ink-2)"} opacity={isHl || !highlightHeatId ? 1 : 0.45} />
                  {xb > xm ? <rect x={xm} y={laneY} width={Math.max(1, xb - xm - 1)} height={laneH - 8} rx={2} fill={`url(#hold-${pid})`} stroke="var(--amber-mark)" strokeWidth={0.8} /> : null}
                  {h.flagged ? <rect x={xa - 1.5} y={laneY - 1.5} width={xb - xa + 2} height={laneH - 5} rx={3} fill="none" stroke="var(--amber-mark)" strokeWidth={1.5} /> : null}
                  {label ? (
                    <text x={xa + 3} y={laneY + laneH + 4} className={`num text-[10px] ${h.flagged ? "fill-amber font-semibold" : "fill-ink-3"}`}>
                      {h.heatNo}
                    </text>
                  ) : null}
                  {h.mouldReadyMin !== null && h.mouldReadyMin > h.startMin && h.mouldReadyMin <= (h.tapMin ?? 0) + 1 && h.holdingMinutes ? (
                    <line x1={sx(h.mouldReadyMin)} x2={sx(h.mouldReadyMin)} y1={laneY - 4} y2={laneY + laneH - 4} stroke="var(--teal)" strokeWidth={2} />
                  ) : null}
                </g>
              );
              return linkHeats ? (
                <g
                  key={h.id}
                  role="link"
                  tabIndex={0}
                  aria-label={`Open heat ${h.heatNo}`}
                  className="cursor-pointer focus:outline-none [&:focus>g>rect]:stroke-blue"
                  onClick={() => router.push(`/heats/${h.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") router.push(`/heats/${h.id}`);
                  }}
                >
                  {body}
                </g>
              ) : (
                <g key={h.id}>{body}</g>
              );
            })}
        </g>

        {ticks.map((t) => (
          <text key={t} x={sx(t)} y={height - 4} textAnchor="middle" className="num fill-ink-3 text-[10.5px]">
            {hhmm(t)}
          </text>
        ))}

        {hover !== null ? <line x1={sx(hover + 0.5)} x2={sx(hover + 0.5)} y1={plotTop} y2={laneY + laneH - 6} stroke="var(--ink)" strokeWidth={1} opacity={0.5} pointerEvents="none" /> : null}
      </svg>

      {hover !== null ? (
        <div
          className="pointer-events-none absolute z-10 rounded-md border border-line bg-surface px-3 py-2 text-[12px] shadow-lg"
          style={{ left: Math.min(Math.max(sx(hover) + 12, 0), width - 190), top: 8, width: 180 }}
        >
          <p className="num font-semibold">{hhmm(hover)}</p>
          <p className="num text-ink-2">{hoverPoint?.kw === null || hoverPoint === null ? "No reading" : `${fmt(hoverPoint?.kw, 0)} kW`}</p>
          <p className="text-ink-3">{hoverHeat ? `${hoverHeat.heatNo} · ${phase}` : "No heat in the log"}</p>
          <p className="text-ink-3">{hoverBand ? `${hoverBand.label} · ₹${(hoverBand.ratePaise / 100).toFixed(2)}/kWh` : "—"}</p>
        </div>
      ) : null}

      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-ink-3" aria-label="Legend">
        <li className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 bg-ink" aria-hidden /> Furnace power (1-min)
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-sm bg-ink-2" aria-hidden /> Melting
        </li>
        <li className="flex items-center gap-1.5">
          <span className="hatch-amber h-2.5 w-4 rounded-sm border border-amber-mark" aria-hidden /> Holding (metal waiting)
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-3 w-0.5 bg-teal" aria-hidden /> Mould ready
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-sm" style={{ background: "var(--band-solar)" }} aria-hidden /> Solar window
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-sm" style={{ background: "var(--band-peak)" }} aria-hidden /> Peak window
        </li>
      </ul>
    </div>
  );
}
