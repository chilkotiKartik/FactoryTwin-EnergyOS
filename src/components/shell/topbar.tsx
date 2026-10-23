"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import * as Popover from "@radix-ui/react-popover";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { Bell, CalendarDays, ChevronDown, ClipboardCheck, LogOut, Radio, TriangleAlert, WifiOff, FlaskConical, Building2 } from "lucide-react";
import { toast } from "sonner";
import { logoutAction, setDayAction, switchFactoryAction } from "@/app/actions";
import { cn } from "@/lib/cn";
import { dayLabel, localTime } from "@/lib/format";
import { Tip } from "@/components/ui/tip";

type Role = "OWNER" | "SUPERVISOR" | "OPERATOR" | "ANALYST";
const ROLE_LABEL: Record<Role, string> = { OWNER: "Owner", SUPERVISOR: "Supervisor", OPERATOR: "Operator", ANALYST: "Analyst" };

export interface TopbarProps {
  actor: { name: string; email: string; role: Role };
  factories: { factoryId: string; factoryName: string; role: Role; isSimulation: boolean }[];
  activeFactoryId: string;
  mode: { mode: "SIMULATION" | "LIVE" | "OFFLINE"; lastReadingAt: number | null; detail: string };
  day: string | null;
  days: string[];
  timeZone: string;
  notifications: { id: string; kind: "approval" | "anomaly"; title: string; body: string; href: string }[];
  sticky: boolean;
}

function ModeBadge({ mode, timeZone }: { mode: TopbarProps["mode"]; timeZone: string }) {
  const Icon = mode.mode === "SIMULATION" ? FlaskConical : mode.mode === "LIVE" ? Radio : WifiOff;
  const cls =
    mode.mode === "SIMULATION" ? "border-violet/30 bg-violet/10 text-violet" : mode.mode === "LIVE" ? "border-teal/30 bg-teal-soft text-teal" : "border-line-strong bg-surface-3 text-ink-2";
  return (
    <Tip
      content={
        <span>
          {mode.detail}
          {mode.lastReadingAt ? <span className="mt-1 block text-white/70">Last reading {localTime(mode.lastReadingAt, timeZone, true)}</span> : null}
        </span>
      }
    >
      <span tabIndex={0} className={cn("inline-flex h-7 items-center gap-1.5 rounded border px-2 text-[11px] font-semibold uppercase tracking-wider", cls)} data-testid="data-mode">
        <Icon className="size-3.5" aria-hidden />
        {mode.mode}
      </span>
    </Tip>
  );
}

export function Topbar({ actor, factories, activeFactoryId, mode, day, days, timeZone, notifications, sticky }: TopbarProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const active = factories.find((f) => f.factoryId === activeFactoryId);

  return (
    <header className={cn("no-print z-20 border-b border-line bg-surface/95 backdrop-blur", sticky ? "sticky top-0" : "sticky top-[23px]")}>
      <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-2 px-4 sm:gap-3 sm:px-6 lg:px-8">
        <label className="sr-only" htmlFor="factory-select">
          Factory
        </label>
        <div className="relative flex min-w-0 items-center">
          <Building2 className="pointer-events-none absolute left-2.5 size-4 text-ink-3" aria-hidden />
          <select
            id="factory-select"
            value={activeFactoryId}
            disabled={pending || factories.length < 2}
            onChange={(e) =>
              start(async () => {
                const r = await switchFactoryAction(e.target.value);
                if (!r.ok) toast.error(r.message);
                else router.refresh();
              })
            }
            className="h-9 max-w-[52vw] truncate rounded-md border border-line-strong bg-surface pl-8 pr-7 text-[13px] font-medium disabled:opacity-100 sm:max-w-xs"
          >
            {factories.map((f) => (
              <option key={f.factoryId} value={f.factoryId}>
                {f.factoryName}
              </option>
            ))}
          </select>
        </div>

        <label className="sr-only" htmlFor="day-select">
          Production day
        </label>
        <div className="relative hidden items-center md:flex">
          <CalendarDays className="pointer-events-none absolute left-2.5 size-4 text-ink-3" aria-hidden />
          <select
            id="day-select"
            value={day ?? ""}
            disabled={pending || days.length === 0}
            onChange={(e) =>
              start(async () => {
                const r = await setDayAction(e.target.value);
                if (!r.ok) toast.error(r.message);
                else router.refresh();
              })
            }
            className="num h-9 rounded-md border border-line-strong bg-surface pl-8 pr-7 text-[13px]"
          >
            {days.length === 0 ? <option value="">No production days</option> : null}
            {days.map((d) => (
              <option key={d} value={d}>
                {dayLabel(d)}
              </option>
            ))}
          </select>
        </div>
        <span className="hidden text-[12px] text-ink-3 xl:inline">Shift 06:00–22:00 · {timeZone}</span>

        <div className="ml-auto flex items-center gap-2">
          <ModeBadge mode={mode} timeZone={timeZone} />

          <Popover.Root>
            <Popover.Trigger asChild>
              <button type="button" className="relative grid size-9 place-items-center rounded-md text-ink-2 hover:bg-surface-3" aria-label={`Notifications (${notifications.length})`}>
                <Bell className="size-4.5" />
                {notifications.length ? (
                  <span className="num absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-amber-mark px-1 text-[10px] font-bold text-white">{notifications.length}</span>
                ) : null}
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content align="end" sideOffset={8} className="z-50 w-[min(92vw,380px)] rounded-lg border border-line bg-surface shadow-xl">
                <p className="border-b border-line px-4 py-2.5 text-[12px] font-semibold uppercase tracking-wide text-ink-3">Needs attention</p>
                {notifications.length === 0 ? (
                  <p className="px-4 py-6 text-center text-[13px] text-ink-3">Nothing pending. No open high-variance heats.</p>
                ) : (
                  <ul className="max-h-96 overflow-y-auto">
                    {notifications.map((n) => (
                      <li key={n.id} className="border-b border-line last:border-0">
                        <Popover.Close asChild>
                          <Link href={n.href} className="flex gap-3 px-4 py-3 hover:bg-surface-2">
                            {n.kind === "approval" ? <ClipboardCheck className="mt-0.5 size-4 shrink-0 text-amber" /> : <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber" />}
                            <span className="min-w-0">
                              <span className="block text-[13px] font-medium text-ink">{n.title}</span>
                              <span className="line-clamp-2 text-[12px] text-ink-3">{n.body}</span>
                            </span>
                          </Link>
                        </Popover.Close>
                      </li>
                    ))}
                  </ul>
                )}
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>

          <Menu.Root>
            <Menu.Trigger asChild>
              <button type="button" className="flex h-9 items-center gap-2 rounded-md px-1.5 text-left hover:bg-surface-3 sm:px-2" aria-label="Account menu">
                <span className="grid size-7 place-items-center rounded-full bg-shell text-[11px] font-semibold text-white">
                  {actor.name
                    .split(" ")
                    .map((p) => p[0])
                    .slice(0, 2)
                    .join("")}
                </span>
                <span className="hidden min-w-0 sm:block">
                  <span className="block max-w-36 truncate text-[13px] font-medium leading-tight">{actor.name}</span>
                  <span className="block text-[11px] leading-tight text-ink-3" data-testid="current-role">
                    {ROLE_LABEL[actor.role]}
                  </span>
                </span>
                <ChevronDown className="hidden size-3.5 text-ink-3 sm:block" />
              </button>
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Content align="end" sideOffset={8} className="z-50 min-w-56 rounded-lg border border-line bg-surface p-1 shadow-xl">
                <div className="px-3 py-2">
                  <p className="text-[13px] font-medium">{actor.name}</p>
                  <p className="text-[12px] text-ink-3">{actor.email}</p>
                  <p className="mt-1 text-[12px] text-ink-2">
                    {ROLE_LABEL[actor.role]} · {active?.factoryName}
                  </p>
                </div>
                <Menu.Separator className="my-1 h-px bg-line" />
                <form action={logoutAction}>
                  <Menu.Item asChild>
                    <button type="submit" className="flex w-full items-center gap-2 rounded px-3 py-2 text-[13px] text-ink outline-none data-[highlighted]:bg-surface-3">
                      <LogOut className="size-4" /> Sign out
                    </button>
                  </Menu.Item>
                </form>
              </Menu.Content>
            </Menu.Portal>
          </Menu.Root>
        </div>
      </div>
    </header>
  );
}
