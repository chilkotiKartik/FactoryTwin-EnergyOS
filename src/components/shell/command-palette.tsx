"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { ArrowRight, Building2, CalendarDays, CornerDownLeft, Flame, LogOut, Search } from "lucide-react";
import { toast } from "sonner";
import { logoutAction, setDayAction, switchFactoryAction } from "@/app/actions";
import { dayLabel } from "@/lib/format";
import { cn } from "@/lib/cn";

export type PaletteHeat = { id: string; heatNo: string; holdingMinutes: number | null; flagged: boolean };

type Command = { id: string; group: string; label: string; hint?: string; keywords?: string; icon: React.ComponentType<{ className?: string }>; run: () => void | Promise<void> };

const SECTIONS: { href: string; label: string; keywords: string; audit?: true; sim?: true }[] = [
  { href: "/dashboard", label: "Dashboard", keywords: "home overview kpi" },
  { href: "/heats", label: "Heat log", keywords: "heats melt log" },
  { href: "/meters", label: "Meter data", keywords: "energy kw readings import" },
  { href: "/anomalies", label: "Anomalies", keywords: "variance flags alerts" },
  { href: "/optimizer", label: "Schedule optimiser", keywords: "plan schedule optimise run" },
  { href: "/recommendations", label: "Approvals", keywords: "recommendations decide approve" },
  { href: "/verification", label: "Verification", keywords: "savings baseline outcome" },
  { href: "/tariffs", label: "Tariffs", keywords: "tod price solar peak" },
  { href: "/reports", label: "Reports & exports", keywords: "csv export download" },
  { href: "/reports/daily", label: "Daily report (print)", keywords: "print pdf shift report" },
  { href: "/audit", label: "Audit log", keywords: "history who changed", audit: true },
  { href: "/evidence", label: "Evidence & assumptions", keywords: "sources deck assumptions" },
  { href: "/settings", label: "Factory settings", keywords: "furnace configure" },
  { href: "/account", label: "Account", keywords: "password profile sessions" },
  { href: "/demo", label: "Scenario control", keywords: "demo reset scenario", sim: true },
];

/** Score a query against text: all terms must appear; prefix matches rank higher. */
function score(q: string, text: string): number {
  const t = text.toLowerCase();
  let s = 0;
  for (const term of q.toLowerCase().split(/\s+/).filter(Boolean)) {
    const i = t.indexOf(term);
    if (i < 0) return -1;
    s += i === 0 ? 3 : t[i - 1] === " " ? 2 : 1;
  }
  return s;
}

export function CommandPalette({
  canSeeAudit,
  isSimulation,
  heats,
  day,
  days,
  factories,
  activeFactoryId,
}: {
  canSeeAudit: boolean;
  isSimulation: boolean;
  heats: PaletteHeat[];
  day: string | null;
  days: string[];
  factories: { factoryId: string; factoryName: string }[];
  activeFactoryId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [, start] = useTransition();
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    function onOpen() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("energyos:palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("energyos:palette", onOpen);
    };
  }, []);

  const commands = useMemo<Command[]>(() => {
    const go = (href: string) => () => router.push(href);
    const out: Command[] = SECTIONS.filter((s) => (!s.audit || canSeeAudit) && (!s.sim || isSimulation)).map((s) => ({
      id: `nav:${s.href}`,
      group: "Go to",
      label: s.label,
      keywords: s.keywords,
      icon: ArrowRight,
      run: go(s.href),
    }));
    for (const h of heats) {
      const hold = h.holdingMinutes !== null && h.holdingMinutes >= 1 ? `${Math.round(h.holdingMinutes)} min holding` : undefined;
      out.push({
        id: `heat:${h.id}`,
        group: day ? `Heats on ${dayLabel(day)}` : "Heats",
        label: h.heatNo,
        hint: [hold, h.flagged ? "flagged" : undefined].filter(Boolean).join(" · ") || undefined,
        keywords: `heat ${h.flagged ? "flagged anomaly" : ""}`,
        icon: Flame,
        run: go(`/heats/${h.id}`),
      });
    }
    for (const f of factories) {
      if (f.factoryId === activeFactoryId) continue;
      out.push({
        id: `fac:${f.factoryId}`,
        group: "Switch factory",
        label: f.factoryName,
        keywords: "factory switch",
        icon: Building2,
        run: () =>
          start(async () => {
            const r = await switchFactoryAction(f.factoryId);
            if (!r.ok) toast.error(r.message);
            else {
              toast.success(`Switched to ${f.factoryName}`);
              router.refresh();
            }
          }),
      });
    }
    for (const d of days) {
      if (d === day) continue;
      out.push({
        id: `day:${d}`,
        group: "Production day",
        label: dayLabel(d),
        keywords: `day date ${d}`,
        icon: CalendarDays,
        run: () =>
          start(async () => {
            const r = await setDayAction(d);
            if (!r.ok) toast.error(r.message);
            else router.refresh();
          }),
      });
    }
    out.push({ id: "logout", group: "Account", label: "Sign out", keywords: "logout log out exit", icon: LogOut, run: () => start(() => logoutAction()) });
    return out;
  }, [router, canSeeAudit, isSimulation, heats, day, days, factories, activeFactoryId]);

  const results = useMemo(() => {
    if (!q.trim()) {
      // No query: sections, heats, then the rest; days are long, so show the latest few.
      const dayCmds = commands.filter((c) => c.group === "Production day").slice(0, 5);
      return [...commands.filter((c) => c.group !== "Production day"), ...dayCmds];
    }
    return commands
      .map((c) => ({ c, s: score(q, `${c.label} ${c.keywords ?? ""} ${c.group}`) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 40)
      .map((x) => x.c);
  }, [q, commands]);

  const safeActive = Math.min(active, Math.max(0, results.length - 1));

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${safeActive}"]`)?.scrollIntoView({ block: "nearest" });
  }, [safeActive]);

  function choose(c: Command | undefined) {
    if (!c) return;
    setOpen(false);
    setQ("");
    setActive(0);
    void c.run();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (results.length ? (Math.min(a, results.length - 1) + 1) % results.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (results.length ? (Math.min(a, results.length - 1) - 1 + results.length) % results.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(results[safeActive]);
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setQ("");
          setActive(0);
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-shell/40 backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-[12vh] z-50 w-[min(640px,calc(100vw-32px))] -translate-x-1/2 animate-fade-up overflow-hidden rounded-card border border-line bg-surface shadow-overlay"
          data-testid="command-palette"
        >
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <div className="flex items-center gap-2 border-b border-line px-3">
            <Search className="size-4 text-ink-3" aria-hidden />
            <input
              autoFocus
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              placeholder="Jump to a page, heat, day or factory…"
              className="h-12 flex-1 bg-transparent text-[14px] placeholder:text-ink-3"
              // The open dialog is the focus indicator; a ring around the bare input looks like an error.
              style={{ outline: "none" }}
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={results[safeActive] ? `${listId}-${safeActive}` : undefined}
              aria-label="Search commands"
            />
            <kbd className="rounded border border-line px-1.5 py-0.5 text-[11px] text-ink-3">Esc</kbd>
          </div>
          <ul ref={listRef} id={listId} role="listbox" aria-label="Commands" className="max-h-[min(420px,60vh)] overflow-y-auto p-1.5">
            {results.length === 0 ? <li className="px-3 py-6 text-center text-[13px] text-ink-3">Nothing matches “{q}”.</li> : null}
            {results.map((c, i) => {
              const header = c.group !== results[i - 1]?.group ? c.group : null;
              const Icon = c.icon;
              return (
                <li key={c.id} role="presentation">
                  {header ? (
                    <p className="px-2.5 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-3" aria-hidden>
                      {header}
                    </p>
                  ) : null}
                  <div
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === safeActive}
                    data-index={i}
                    onPointerMove={() => setActive(i)}
                    onClick={() => choose(c)}
                    className={cn("flex cursor-pointer items-center gap-2.5 rounded-control px-2.5 py-2 text-[13.5px]", i === safeActive ? "bg-surface-3 text-ink" : "text-ink-2")}
                  >
                    <Icon className="size-4 shrink-0 text-ink-3" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">
                      {c.label}
                      <span className="sr-only">, {c.group}</span>
                    </span>
                    {c.hint ? <span className="num shrink-0 text-[12px] text-ink-3">{c.hint}</span> : null}
                    {i === safeActive ? <CornerDownLeft className="size-3.5 shrink-0 text-ink-3" aria-hidden /> : null}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="border-t border-line px-3 py-2 text-[11.5px] text-ink-3">↑ ↓ to move · Enter to open · Ctrl/⌘ K to toggle. Pages still check your role on the server.</p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** A visible button that opens the palette (for mouse and touch users). */
export function PaletteButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("energyos:palette"))}
      className={cn("inline-flex h-9 items-center gap-2 rounded-md border border-line-strong bg-surface px-2.5 text-[13px] text-ink-3 hover:text-ink", className)}
      aria-label="Open command palette"
      aria-keyshortcuts="Control+K Meta+K"
    >
      <Search className="size-4" aria-hidden />
      <span className="hidden whitespace-nowrap 2xl:inline">Jump to…</span>
      <kbd className="hidden whitespace-nowrap rounded border border-line px-1 text-[10.5px] 2xl:inline">Ctrl K</kbd>
    </button>
  );
}
