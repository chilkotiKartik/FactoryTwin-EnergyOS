"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import * as D from "@radix-ui/react-dialog";
import { CornerDownLeft, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n/context";
import { ACCOUNT_ITEM, navGroups, type NavContext } from "./nav";

export const OPEN_SEARCH_EVENT = "energyos:open-search";

/** ⌘K / Ctrl+K jump-to-anything. Lists only pages this user can open. */
export function CommandPalette(ctx: NavContext) {
  const router = useRouter();
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const items = useMemo(() => {
    const all = navGroups(ctx).flatMap((g) => g.items.map((i) => ({ ...i, group: t(g.title), text: t(i.label) })));
    all.push({ ...ACCOUNT_ITEM, label: "lang.label", group: "", text: "Account", keywords: ACCOUNT_ITEM.keywords });
    return all;
  }, [ctx, t]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((i) => `${i.text} ${i.keywords} ${i.href}`.toLowerCase().includes(s));
  }, [items, q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_SEARCH_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_SEARCH_EVENT, onOpen);
    };
  }, []);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  const change = (v: boolean) => {
    setOpen(v);
    if (!v) {
      setQ("");
      setSel(0);
    }
  };

  return (
    <D.Root open={open} onOpenChange={change}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-[fadeIn_120ms_ease-out]" />
        <D.Content className="pop fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-24px)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border border-line bg-surface data-[state=open]:animate-[slideUp_160ms_ease-out]" aria-describedby={undefined}>
          <D.Title className="sr-only">{t("search.open")}</D.Title>
          <div className="flex items-center gap-3 border-b border-line px-4">
            <Search className="size-4 text-ink-3" aria-hidden />
            <input
              autoFocus
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setSel(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setSel((s) => Math.min(shown.length - 1, s + 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setSel((s) => Math.max(0, s - 1));
                } else if (e.key === "Enter" && shown[sel]) {
                  e.preventDefault();
                  go(shown[sel].href);
                }
              }}
              placeholder={t("search.placeholder")}
              aria-label={t("search.open")}
              aria-controls="cmd-list"
              aria-activedescendant={shown[sel] ? `cmd-${shown[sel].href}` : undefined}
              className="h-14 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-3"
            />
            <kbd className="hidden rounded-md border border-line px-1.5 py-0.5 text-[11px] text-ink-3 sm:block">Esc</kbd>
          </div>
          <ul id="cmd-list" ref={listRef} role="listbox" className="max-h-[55vh] overflow-y-auto p-2">
            {shown.length === 0 ? <li className="px-3 py-8 text-center text-[13px] text-ink-3">{t("search.empty")}</li> : null}
            {shown.map((i, idx) => {
              const Icon = i.icon;
              return (
                <li key={i.href} id={`cmd-${i.href}`} role="option" aria-selected={idx === sel}>
                  <button
                    type="button"
                    onMouseEnter={() => setSel(idx)}
                    onClick={() => go(i.href)}
                    className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px]", idx === sel ? "bg-surface-3 text-ink" : "text-ink-2")}
                  >
                    <span className="grid size-8 place-items-center rounded-lg border border-line bg-surface-2">
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <span className="flex-1">{i.text}</span>
                    {i.group ? <span className="text-[11px] uppercase tracking-wide text-ink-3">{i.group}</span> : null}
                    {idx === sel ? <CornerDownLeft className="size-3.5 text-ink-3" aria-hidden /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
