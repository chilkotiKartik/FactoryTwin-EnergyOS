"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { CalendarClock, ClipboardCheck, Flame, LayoutDashboard, Menu, X, Zap } from "lucide-react";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n/context";
import type { MessageKey } from "@/lib/i18n/messages";
import { isActive, navGroups } from "./nav";

export function Sidebar({ factoryName, isSimulation, pendingApprovals, canSeeAudit }: { factoryName: string; isSimulation: boolean; pendingApprovals: number; canSeeAudit: boolean }) {
  const pathname = usePathname();
  const { t } = useT();
  // The drawer remembers the page it was opened on, so navigating closes it.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === pathname;
  const setOpen = (v: boolean) => setOpenAt(v ? pathname : null);
  const groups = navGroups({ canSeeAudit, isSimulation });
  const badge = (href: string) => (href === "/recommendations" ? pendingApprovals : 0);

  const nav = (
    <nav aria-label="Main" className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 pb-6">
      {groups.map((g) => (
        <div key={g.title}>
          <p className="px-2.5 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-shell-muted">{t(g.title)}</p>
          <ul className="flex flex-col gap-0.5">
            {g.items.map((it) => {
              const active = isActive(pathname, it.href);
              const Icon = it.icon;
              const n = badge(it.href);
              return (
                <li key={it.href} className="relative">
                  {active ? (
                    <motion.span layoutId="nav-active" className="absolute inset-0 rounded-lg bg-white/[0.07]" transition={{ type: "spring", stiffness: 500, damping: 40 }} aria-hidden>
                      <span className="brand-gradient absolute inset-y-1.5 left-0 w-[3px] rounded-full" />
                    </motion.span>
                  ) : null}
                  <Link
                    href={it.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] transition-colors",
                      active ? "font-medium text-white" : "text-shell-ink hover:bg-white/[0.04] hover:text-white",
                    )}
                  >
                    <Icon className={cn("size-4", active ? "text-[var(--brand-1)]" : "text-shell-muted")} />
                    <span className="flex-1">{t(it.label)}</span>
                    {n ? (
                      <span className="num rounded-full bg-amber-mark px-1.5 text-[11px] font-semibold text-white" aria-label={`${n} pending`}>
                        {n}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  const brand = (
    <Link href="/dashboard" className="flex items-center gap-3 px-5 pb-5 pt-5">
      <div className="brand-gradient grid size-9 place-items-center rounded-lg">
        <Zap className="size-[18px] text-white" aria-hidden />
      </div>
      <div className="min-w-0">
        <p className="text-[14.5px] font-semibold leading-tight tracking-tight text-white">
          FactoryTwin <span className="brand-text">EnergyOS</span>
        </p>
        <p className="truncate text-[11px] text-shell-muted" title={factoryName}>
          {factoryName}
        </p>
      </div>
    </Link>
  );

  const foot = (
    <div className="border-t border-white/5 px-5 py-3">
      <p className="flex items-center gap-2 text-[11px] leading-snug text-shell-muted">
        <span className="size-1.5 shrink-0 rounded-full bg-teal-mark animate-[pulseDot_2.4s_ease-in-out_infinite]" aria-hidden />
        {t("nav.advisory")}
      </p>
    </div>
  );

  const shellBg = "bg-shell";

  // Phone bottom bar: the four places used most on the floor, plus "More" for the full menu.
  const tabs: { href: string; label: MessageKey; icon: typeof Flame }[] = [
    { href: "/dashboard", label: "nav.dashboard", icon: LayoutDashboard },
    { href: "/heats", label: "nav.heats", icon: Flame },
    { href: "/optimizer", label: "nav.optimizerShort", icon: CalendarClock },
    { href: "/recommendations", label: "nav.approvals", icon: ClipboardCheck },
  ];

  return (
    <>
      <aside className={cn("no-print fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-white/5 lg:flex", shellBg)}>
        {brand}
        {nav}
        {foot}
      </aside>

      <nav aria-label="Quick" className="no-print safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/85 backdrop-blur-xl lg:hidden">
        <ul className="mx-auto grid max-w-lg grid-cols-5">
          {tabs.map((tab) => {
            const active = isActive(pathname, tab.href);
            const Icon = tab.icon;
            const n = badge(tab.href);
            return (
              <li key={tab.href}>
                <Link href={tab.href} aria-current={active ? "page" : undefined} className={cn("relative flex h-16 flex-col items-center justify-center gap-1 text-[10.5px] font-medium", active ? "text-ink" : "text-ink-3")}>
                  {active ? <span className="brand-gradient absolute top-0 h-0.5 w-8 rounded-full" aria-hidden /> : null}
                  <span className="relative">
                    <Icon className={cn("size-5", active ? "text-[var(--brand-2)]" : "")} aria-hidden />
                    {n ? <span className="num absolute -right-2.5 -top-1.5 grid min-w-4 place-items-center rounded-full bg-amber-mark px-1 text-[9.5px] font-bold text-white">{n}</span> : null}
                  </span>
                  <span className="max-w-full truncate px-1">{t(tab.label)}</span>
                </Link>
              </li>
            );
          })}
          <li>
            <button type="button" onClick={() => setOpen(true)} className="flex h-16 w-full flex-col items-center justify-center gap-1 text-[10.5px] font-medium text-ink-3" aria-label={t("nav.open")} aria-expanded={open}>
              <Menu className="size-5" aria-hidden />
              {t("nav.more")}
            </button>
          </li>
        </ul>
      </nav>

      <AnimatePresence>
        {open ? (
          <>
            <motion.div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)} />
            <motion.aside
              role="dialog"
              aria-modal="true"
              aria-label="Navigation"
              className={cn("fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col lg:hidden", shellBg)}
              initial={{ x: -300 }}
              animate={{ x: 0 }}
              exit={{ x: -300 }}
              transition={{ type: "tween", duration: 0.2 }}
            >
              <button type="button" onClick={() => setOpen(false)} className="absolute right-3 top-5 rounded-lg p-1.5 text-shell-ink hover:bg-white/10" aria-label={t("nav.close")}>
                <X className="size-5" />
              </button>
              {brand}
              {nav}
              {foot}
            </motion.aside>
          </>
        ) : null}
      </AnimatePresence>
    </>
  );
}
