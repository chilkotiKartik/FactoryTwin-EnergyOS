import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

export function EmptyState({ icon: Icon, title, children, action, className }: { icon: LucideIcon; title: string; children?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 py-12 text-center", className)}>
      <div className="grid size-10 place-items-center rounded-full bg-surface-3 text-ink-3">
        <Icon className="size-5" aria-hidden />
      </div>
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {children ? <div className="max-w-md text-[13px] text-ink-3">{children}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
