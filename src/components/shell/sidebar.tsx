"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import {
  BadgeCheck,
  BookOpen,
  CalendarClock,
  ClipboardCheck,
  Factory,
  FileText,
  Flame,
  FlaskConical,
  Gauge,
  History,
  IndianRupee,
  LayoutDashboard,
  Menu,
  Settings,
  TriangleAlert,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n/context";
import type { MessageKey } from "@/lib/i18n/messages";

type Item = { href: string; label: MessageKey; icon: React.ComponentType<{ className?: string }>; badge?: number };

export function Sidebar({ factoryName, isSimulation, pendingApprovals, canSeeAudit }: { factoryName: string; isSimulation: boolean; pendingApprovals: number; canSeeAudit: boolean }) {
  const pathname = usePathname();
  // The drawer remembers the page it was opened on, so navigating closes it.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === pathname;
  const setOpen = (v: boolean) => setOpenAt(v ? pathname : null);

  const { t } = useT();
  const groups: { title: MessageKey; items: Item[] }[] = [
    { title: "nav.overview", items: [{ href: "/dashboard", label: "nav.dashboard", icon: LayoutDashboard }] },
    {
      title: "nav.operations",
      items: [
        { href: "/heats", label: "nav.heats", icon: Flame },
        { href: "/meters", label: "nav.meters", icon: Gauge },
        { href: "/anomalies", label: "nav.anomalies", icon: TriangleAlert },
      ],
    },
    {
      title: "nav.decisions",
      items: [
        { href: "/optimizer", label: "nav.optimizer", icon: CalendarClock },
        { href: "/recommendations", label: "nav.approvals", icon: ClipboardCheck, badge: pendingApprovals },
        { href: "/verification", label: "nav.verification", icon: BadgeCheck },
      ],
    },
    {
      title: "nav.records",
      items: [
        { href: "/tariffs", label: "nav.tariffs", icon: IndianRupee },
        { href: "/reports", label: "nav.reports", icon: FileText },
        ...(canSeeAudit ? [{ href: "/audit", label: "nav.audit" as const, icon: History }] : []),
        { href: "/evidence", label: "nav.evidence", icon: BookOpen },
        { href: "/settings", label: "nav.settings", icon: Settings },
      ],
    },
    ...(isSimulation ? [{ title: "nav.demo" as const, items: [{ href: "/demo", label: "nav.scenario" as const, icon: FlaskConical }] }] : []),
  ];

  const nav = (
    <nav aria-label="Main" className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 pb-6">
      {groups.map((g) => (
        <div key={g.title}>
          <p className="px-2 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-shell-muted">{t(g.title)}</p>
          <ul className="flex flex-col gap-0.5">
            {g.items.map((it) => {
              const active = pathname === it.href || pathname.startsWith(`${it.href}/`);
              const Icon = it.icon;
              return (
                <li key={it.href} className="relative">
                  {active ? (
                    <motion.span layoutId="nav-active" className="absolute inset-0 rounded-md bg-shell-3" transition={{ type: "spring", stiffness: 500, damping: 40 }} aria-hidden />
                  ) : null}
                  <Link
                    href={it.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "relative flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13.5px] transition-colors",
                      active ? "font-medium text-white" : "text-shell-ink hover:bg-shell-2 hover:text-white",
                    )}
                  >
                    <Icon className={cn("size-4", active ? "text-amber-mark" : "text-shell-muted")} />
                    <span className="flex-1">{t(it.label)}</span>
                    {it.badge ? (
                      <span className="num rounded bg-amber-mark px-1.5 text-[11px] font-semibold text-white" aria-label={`${it.badge} pending`}>
                        {it.badge}
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
    <div className="flex items-center gap-2.5 px-5 pb-5 pt-5">
      <div className="grid size-7 place-items-center rounded bg-amber-mark text-white">
        <Factory className="size-4" aria-hidden />
      </div>
      <div className="min-w-0">
        <p className="text-[14px] font-semibold leading-tight tracking-tight text-white">FactoryTwin EnergyOS</p>
        <p className="truncate text-[11px] text-shell-muted" title={factoryName}>
          {factoryName}
        </p>
      </div>
    </div>
  );

  const foot = (
    <p className="border-t border-shell-2 px-5 py-3 text-[11px] leading-snug text-shell-muted">{t("nav.advisory")}</p>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="no-print fixed bottom-4 left-4 z-40 grid size-11 place-items-center rounded-full bg-shell text-white shadow-lg lg:hidden"
        aria-label={t("nav.open")}
        aria-expanded={open}
      >
        <Menu className="size-5" />
      </button>
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-shell lg:flex">
        {brand}
        {nav}
        {foot}
      </aside>
      <AnimatePresence>
        {open ? (
          <>
            <motion.div className="fixed inset-0 z-40 bg-black/40 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)} />
            <motion.aside
              role="dialog"
              aria-modal="true"
              aria-label="Navigation"
              className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-shell lg:hidden"
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: "tween", duration: 0.18 }}
            >
              <button type="button" onClick={() => setOpen(false)} className="absolute right-3 top-4 rounded p-1 text-shell-ink hover:bg-shell-2" aria-label={t("nav.close")}>
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
