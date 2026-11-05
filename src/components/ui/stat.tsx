import { Info } from "lucide-react";
import { cn } from "@/lib/cn";
import { Evidence } from "./badge";
import { Tip } from "./tip";

export interface StatProps {
  label: string;
  value: string;
  unit?: string;
  /** Exact calculation, period and source shown on hover. */
  definition: string;
  evidence?: string;
  delta?: { text: string; tone: "good" | "bad" | "neutral" } | null;
  emphasis?: "amber" | "teal" | "red" | null;
  className?: string;
}

/** A KPI with a defined unit, time range, source and calculation. */
export function Stat({ label, value, unit, definition, evidence, delta, emphasis, className }: StatProps) {
  return (
    <div className={cn("relative flex min-w-0 flex-col gap-1.5 px-4 py-4 sm:px-5", className)}>
      {emphasis ? <span aria-hidden className={cn("absolute inset-x-4 top-0 h-0.5 rounded-full sm:inset-x-5", emphasis === "amber" ? "bg-amber-mark" : emphasis === "teal" ? "bg-teal-mark" : "bg-red-mark")} /> : null}
      <div className="flex items-center gap-1.5 text-[12px] font-medium text-ink-3">
        {emphasis ? <span aria-hidden className={cn("size-1.5 rounded-full", emphasis === "amber" ? "bg-amber-mark" : emphasis === "teal" ? "bg-teal-mark" : "bg-red-mark")} /> : null}
        <span className="truncate">{label}</span>
        <Tip content={definition}>
          <button type="button" aria-label={`How ${label} is calculated`} className="text-ink-3 hover:text-ink">
            <Info className="size-3.5" />
          </button>
        </Tip>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="num text-[24px] font-semibold leading-none tracking-tight text-ink sm:text-[28px]">{value}</span>
        {unit ? <span className="text-[13px] text-ink-3">{unit}</span> : null}
      </div>
      <div className="flex min-h-5 flex-wrap items-center gap-1.5">
        {delta ? <span className={cn("num text-[12px] font-medium", delta.tone === "good" ? "text-teal" : delta.tone === "bad" ? "text-amber" : "text-ink-3")}>{delta.text}</span> : null}
        {evidence ? <Evidence label={evidence} /> : null}
      </div>
    </div>
  );
}
