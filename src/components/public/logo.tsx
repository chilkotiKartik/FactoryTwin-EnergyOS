import Link from "next/link";
import { Factory } from "lucide-react";
import { cn } from "@/lib/cn";

/** Product mark. `tone` picks text colour for dark (shell) or light (canvas) backgrounds. */
export function Logo({ tone = "dark", href = "/", className, compact }: { tone?: "dark" | "light"; href?: string; className?: string; compact?: boolean }) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-2.5 rounded-control", tone === "dark" ? "text-white" : "text-ink", className)}>
      <span className="grid size-8 place-items-center rounded bg-amber-mark text-white">
        <Factory className="size-4.5" aria-hidden />
      </span>
      <span className={cn("whitespace-nowrap text-[15px] font-semibold tracking-tight", compact && "sr-only sm:not-sr-only")}>FactoryTwin EnergyOS</span>
    </Link>
  );
}
