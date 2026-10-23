import { cn } from "@/lib/cn";

export type Tone = "neutral" | "amber" | "teal" | "red" | "blue" | "violet" | "dark";

const tones: Record<Tone, string> = {
  neutral: "bg-surface-3 text-ink-2 border-line",
  amber: "bg-amber-soft text-amber border-amber/25",
  teal: "bg-teal-soft text-teal border-teal/25",
  red: "bg-red-soft text-red border-red/25",
  blue: "bg-blue-soft text-blue border-blue/25",
  violet: "bg-violet/10 text-violet border-violet/25",
  dark: "bg-ink text-white border-ink",
};

export function Badge({ tone = "neutral", className, children, title }: { tone?: Tone; className?: string; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide leading-none", tones[tone], className)}>
      {children}
    </span>
  );
}

const EVIDENCE_TONE: Record<string, Tone> = {
  VERIFIED: "blue",
  ASSUMPTION: "neutral",
  SIMULATED: "violet",
  MODELLED: "amber",
  MEASURED: "teal",
  UNVERIFIED: "neutral",
  NO_DATA: "neutral",
  MANUAL: "neutral",
  IMPORTED_UNVERIFIED: "neutral",
};

const EVIDENCE_HELP: Record<string, string> = {
  VERIFIED: "Supported by an identified source.",
  ASSUMPTION: "A configuration or modelling choice.",
  SIMULATED: "Synthetic scenario data or a synthetic outcome.",
  MODELLED: "A projection or analytical estimate.",
  MEASURED: "Observed by a genuine meter or documented field dataset.",
  UNVERIFIED: "Entered or imported without a declared genuine source.",
  NO_DATA: "No records in this period.",
  MANUAL: "Entered by a person.",
  IMPORTED_UNVERIFIED: "Imported without a declared genuine source.",
};

export function Evidence({ label, className }: { label: string; className?: string }) {
  return (
    <Badge tone={EVIDENCE_TONE[label] ?? "neutral"} className={className} title={EVIDENCE_HELP[label]}>
      {label.replace("_", " ")}
    </Badge>
  );
}
