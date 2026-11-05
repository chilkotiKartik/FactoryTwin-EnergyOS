"use client";

import { CloudOff, Loader2, RefreshCw } from "lucide-react";
import { useT } from "@/lib/i18n/context";
import { Button } from "@/components/ui/button";
import { useOffline } from "./offline-provider";

type Values = { heatNo?: string; chargeKg?: number };

/** Shows connection state, heats waiting to be sent, and heats the server refused. */
export function OfflineBanner() {
  const o = useOffline();
  const { t } = useT();
  if (!o) return null;
  const pending = o.items.filter((i) => i.status === "PENDING");
  const rejected = o.items.filter((i) => i.status === "REJECTED");
  if (o.online && o.items.length === 0) return null;
  return (
    <div className="no-print mb-4 flex flex-col gap-2" role="status" aria-live="polite">
      {!o.online ? (
        <div className="flex items-center gap-2 rounded-md border border-amber/40 bg-amber-soft px-3 py-2 text-[13px] text-ink">
          <CloudOff className="size-4 shrink-0 text-amber" aria-hidden />
          {t("offline.banner")}
        </div>
      ) : null}
      {pending.length ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-[13px]">
          <span className="font-medium">{t("offline.waiting", { n: pending.length })}</span>
          <span className="num text-ink-3">{pending.map((i) => (i.values as Values).heatNo).filter(Boolean).join(", ")}</span>
          <Button type="button" size="sm" variant="secondary" className="ml-auto" disabled={!o.online || o.syncing} onClick={() => void o.syncNow()}>
            {o.syncing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {o.syncing ? t("offline.syncing") : t("offline.syncNow")}
          </Button>
        </div>
      ) : null}
      {rejected.map((i) => (
        <div key={i.id} className="flex flex-wrap items-center gap-2 rounded-md border border-red/30 bg-red-soft px-3 py-2 text-[13px]">
          <span className="font-medium">
            {t("offline.rejected")}: <span className="num">{(i.values as Values).heatNo}</span>
          </span>
          <span className="text-ink-2">{i.message}</span>
          <span className="text-ink-3">{t("offline.checkLog")}</span>
          <Button type="button" size="sm" variant="secondary" className="ml-auto" onClick={() => void o.discard(i.id)}>
            {t("offline.discard")}
          </Button>
        </div>
      ))}
    </div>
  );
}
