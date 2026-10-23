import { cn } from "@/lib/cn";

export function Table({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full border-collapse text-[13px]", className)}>{children}</table>
    </div>
  );
}
export function Th({ className, children, align = "left", ...p }: React.ThHTMLAttributes<HTMLTableCellElement> & { align?: "left" | "right" | "center" }) {
  return (
    <th
      scope="col"
      className={cn("sticky top-0 z-[1] whitespace-nowrap border-b border-line bg-surface-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-3", align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left", className)}
      {...p}
    >
      {children}
    </th>
  );
}
export function Td({ className, children, align = "left", ...p }: React.TdHTMLAttributes<HTMLTableCellElement> & { align?: "left" | "right" | "center" }) {
  return (
    <td className={cn("whitespace-nowrap border-b border-line px-3 py-2 text-ink", align === "right" ? "num text-right" : align === "center" ? "text-center" : "", className)} {...p}>
      {children}
    </td>
  );
}
