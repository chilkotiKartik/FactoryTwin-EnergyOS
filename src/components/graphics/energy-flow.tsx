import { cn } from "@/lib/cn";

export interface FlowFigures {
  meter?: string;
  furnace?: string;
  moulds?: string;
}

/**
 * Animated illustration of the energy path in a foundry: grid → transformer →
 * meter → induction furnace → ladle → moulding line, with the optimiser's plan
 * feeding the furnace. Pure SVG + CSS animation (no JS), so it costs nothing to
 * hydrate and stops moving under prefers-reduced-motion.
 *
 * It is an illustration, never a live feed: optional figures are passed in from
 * stored records and the caller labels where they come from.
 */
export function EnergyFlow({
  tone = "dark",
  figures,
  idPrefix = "ef",
  className,
  title = "Illustration: how energy flows from the grid through the meter and furnace to the moulding line",
}: {
  tone?: "dark" | "light";
  figures?: FlowFigures;
  idPrefix?: string;
  className?: string;
  title?: string;
}) {
  const dark = tone === "dark";
  const line = dark ? "rgb(255 255 255 / 0.22)" : "var(--line-strong)";
  const metal = dark ? "#9fb0c8" : "var(--ink-3)";
  const body = dark ? "#1b2a40" : "var(--surface-3)";
  const body2 = dark ? "#24364f" : "var(--surface-2)";
  const label = dark ? "#c9d4e3" : "var(--ink-2)";
  const muted = dark ? "#8394ad" : "var(--ink-3)";
  const g = (n: string) => `${idPrefix}-${n}`;
  const sparks = [
    { x: 392, d: "0s", sx: "-8px" },
    { x: 402, d: "0.5s", sx: "6px" },
    { x: 410, d: "0.9s", sx: "12px" },
    { x: 398, d: "1.3s", sx: "-2px" },
    { x: 416, d: "0.2s", sx: "-10px" },
    { x: 386, d: "1.1s", sx: "4px" },
  ];

  return (
    <svg viewBox="0 0 760 250" className={cn("block h-auto w-full", className)} role="img" aria-label={title}>
      <defs>
        <linearGradient id={g("molten")} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#fff3c4" />
          <stop offset="0.35" stopColor="#ffb547" />
          <stop offset="1" stopColor="#e2541b" />
        </linearGradient>
        <radialGradient id={g("halo")}>
          <stop offset="0" stopColor="#ff9a3c" stopOpacity="0.75" />
          <stop offset="1" stopColor="#ff9a3c" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={g("cable")} x1="0" x2="1">
          <stop offset="0" stopColor="#5aa9ff" />
          <stop offset="1" stopColor="#ffb547" />
        </linearGradient>
        <filter id={g("blur")} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
        <clipPath id={g("belt")}>
          <rect x="566" y="150" width="182" height="40" />
        </clipPath>
      </defs>

      {/* Ground */}
      <line x1="10" x2="750" y1="196" y2="196" stroke={line} />

      {/* Grid pylon */}
      <g stroke={metal} strokeWidth="1.6" fill="none" strokeLinejoin="round">
        <path d="M30 196 L48 70 L66 196" />
        <path d="M38 140 L58 140 M34 168 L62 168 M42 110 L54 110" />
        <path d="M38 140 L62 168 M58 140 L34 168 M42 110 L58 140 M54 110 L38 140" opacity="0.6" />
        <path d="M28 86 L68 86 M32 98 L64 98" />
      </g>
      <circle cx="28" cy="86" r="2.2" fill={metal} />
      <circle cx="68" cy="86" r="2.2" fill={metal} />

      {/* Cables: a static base plus moving pulses */}
      {["M68 86 C 100 86, 110 130, 140 130", "M190 130 L 238 130", "M300 130 C 330 130, 336 128, 356 128"].map((d) => (
        <g key={d}>
          <path d={d} stroke={line} strokeWidth="3" fill="none" />
          <path d={d} stroke={`url(#${g("cable")})`} strokeWidth="3" fill="none" strokeLinecap="round" className="flow-dash" />
        </g>
      ))}

      {/* Transformer */}
      <rect x="140" y="104" width="50" height="58" rx="5" fill={body} stroke={metal} strokeWidth="1.2" />
      {[0, 1, 2].map((i) => (
        <rect key={i} x={147 + i * 13} y="96" width="8" height="10" rx="2" fill={body2} stroke={metal} strokeWidth="1" />
      ))}
      <path d="M150 122 q5 -6 10 0 t10 0 t10 0 M150 140 q5 -6 10 0 t10 0 t10 0" stroke="#5aa9ff" strokeWidth="1.6" fill="none" className="glow-pulse" />

      {/* Meter */}
      <rect x="238" y="102" width="62" height="56" rx="6" fill={body} stroke={metal} strokeWidth="1.2" />
      <rect x="245" y="110" width="48" height="20" rx="3" fill={dark ? "#0b1422" : "var(--shell)"} />
      <text x="269" y="124" textAnchor="middle" className="num" fontSize="11" fill="#7cf2c4">
        <tspan>kWh</tspan>
        <tspan className="tick">▌</tspan>
      </text>
      <circle cx="252" cy="144" r="3" fill="#7cf2c4" className="glow-pulse-fast" />
      <rect x="260" y="141" width="32" height="6" rx="3" fill={body2} />

      {/* Plan from the optimiser, approved by a supervisor */}
      <g>
        <rect x="330" y="16" width="148" height="30" rx="15" fill={dark ? "rgb(255 255 255 / 0.06)" : "var(--surface)"} stroke={dark ? "rgb(255 255 255 / 0.18)" : "var(--line-strong)"} />
        <circle cx="347" cy="31" r="4" fill="#7cf2c4" className="glow-pulse" />
        <text x="358" y="35" fontSize="11.5" fill={label} fontWeight="600">
          Approved plan
        </text>
        <path d="M404 46 L404 84" stroke="#7cf2c4" strokeWidth="1.6" fill="none" className="flow-dash-slow" />
      </g>

      {/* Induction furnace */}
      <ellipse cx="402" cy="96" rx="56" ry="26" fill={`url(#${g("halo")})`} className="glow-pulse" />
      <path d="M362 98 L372 190 L432 190 L442 98 Z" fill={body} stroke={metal} strokeWidth="1.4" />
      {[0, 1, 2, 3, 4].map((i) => (
        <path
          key={i}
          d={`M${364 + i * 1.9} ${112 + i * 16} L${440 - i * 1.9} ${112 + i * 16}`}
          stroke="#ff8a3c"
          strokeWidth="3"
          strokeLinecap="round"
          className="glow-pulse-fast"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
      <ellipse cx="402" cy="98" rx="40" ry="8" fill={`url(#${g("molten")})`} />
      <ellipse cx="402" cy="98" rx="40" ry="8" fill="#fff3c4" opacity="0.5" filter={`url(#${g("blur")})`} className="glow-pulse" />
      {sparks.map((s, i) => (
        <circle key={i} cx={s.x} cy="94" r="1.8" fill="#ffd27a" className="spark" style={{ animationDelay: s.d, ["--sx" as string]: s.sx }} />
      ))}

      {/* Ladle pouring into the moulds */}
      <g className="ladle-tip">
        <path d="M478 112 L484 150 L522 150 L528 112 Z" fill={body2} stroke={metal} strokeWidth="1.4" />
        <ellipse cx="503" cy="112" rx="25" ry="5" fill={`url(#${g("molten")})`} />
        <path d="M528 116 L548 106" stroke={metal} strokeWidth="3" strokeLinecap="round" />
      </g>
      <path d="M480 118 C 474 132, 584 120, 590 158" stroke="#ffb547" strokeWidth="3" fill="none" strokeLinecap="round" className="pour" />

      {/* Moulding line conveyor */}
      <rect x="560" y="182" width="194" height="8" rx="4" fill={body2} stroke={metal} strokeWidth="1" />
      {Array.from({ length: 9 }, (_, i) => (
        <circle key={i} cx={570 + i * 22} cy="186" r="2" fill={metal} />
      ))}
      <g clipPath={`url(#${g("belt")})`}>
        <g className="conveyor" style={{ ["--travel" as string]: "44px" }}>
          {Array.from({ length: 6 }, (_, i) => {
            const x = 524 + i * 44;
            return (
              <g key={i}>
                <rect x={x} y="160" width="30" height="22" rx="3" fill={body} stroke={metal} strokeWidth="1.1" />
                <rect x={x + 8} y="160" width="14" height="5" rx="1.5" fill="#ff9a3c" opacity="0.9" className="glow-pulse" />
              </g>
            );
          })}
        </g>
      </g>

      {/* Labels */}
      {[
        { x: 48, t: "Grid", s: "ToD tariff" },
        { x: 165, t: "Transformer", s: "" },
        { x: 269, t: "Meter", s: figures?.meter ?? "1-min kWh" },
        { x: 402, t: "Induction furnace", s: figures?.furnace ?? "melt · hold · tap" },
        { x: 503, t: "Ladle", s: "" },
        { x: 657, t: "Moulding line", s: figures?.moulds ?? "mould-ready times" },
      ].map((l) => (
        <g key={l.t}>
          <text x={l.x} y="216" textAnchor="middle" fontSize="12" fontWeight="600" fill={label}>
            {l.t}
          </text>
          {l.s ? (
            <text x={l.x} y="233" textAnchor="middle" fontSize="11" fill={muted} className="num">
              {l.s}
            </text>
          ) : null}
        </g>
      ))}
    </svg>
  );
}
