"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { createHeatAction } from "@/app/actions";
import { useT } from "@/lib/i18n/context";
import { classify, createBrowserStore, flushQueue, newQueueId, type QueuedHeat, type QueueStore } from "@/lib/offline/queue";
import type { ActionResult } from "@/server/errors";

interface OfflineCtx {
  timeZone: string;
  online: boolean;
  items: QueuedHeat[];
  syncing: boolean;
  /** Log a new heat. When the connection is down the heat is kept on this device and sent later. */
  submitHeat(values: unknown): Promise<{ queued: boolean; result?: ActionResult<unknown> }>;
  syncNow(): Promise<void>;
  discard(id: string): Promise<void>;
}

const Ctx = createContext<OfflineCtx | null>(null);

export function useOffline(): OfflineCtx | null {
  return useContext(Ctx);
}

const RETRY_MS = 30_000;

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}
const useOnline = () =>
  useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );

export function OfflineProvider({ userId, factoryId, timeZone, children }: { userId: string; factoryId: string; timeZone: string; children: React.ReactNode }) {
  const { t } = useT();
  const storeRef = useRef<QueueStore | null>(null);
  const store = () => (storeRef.current ??= createBrowserStore());
  const online = useOnline();
  const [items, setItems] = useState<QueuedHeat[]>([]);
  const [syncing, setSyncing] = useState(false);
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    try {
      setItems((await store().list()).filter((i) => i.userId === userId && i.factoryId === factoryId));
    } catch {
      /* storage unavailable: nothing queued */
    }
  }, [userId, factoryId]);

  const syncNow = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setSyncing(true);
    try {
      const r = await flushQueue(store(), { userId, factoryId }, async (item) => classify(await createHeatAction(item.values)));
      if (r.sent) toast.success(t("offline.synced", { n: r.sent }));
      if (r.rejected) toast.error(t("offline.rejected"));
    } finally {
      busy.current = false;
      setSyncing(false);
      await refresh();
    }
  }, [userId, factoryId, refresh, t]);

  useEffect(() => {
    let cancelled = false;
    const up = () => void syncNow();
    window.addEventListener("online", up);
    // Initial load of anything queued earlier, then try to send it.
    void (async () => {
      const mine = (await store().list().catch(() => [])).filter((i) => i.userId === userId && i.factoryId === factoryId);
      if (!cancelled) setItems(mine);
      if (navigator.onLine) await syncNow();
    })();
    const timer = setInterval(() => {
      if (navigator.onLine) void syncNow();
    }, RETRY_MS);
    return () => {
      cancelled = true;
      window.removeEventListener("online", up);
      clearInterval(timer);
    };
  }, [userId, factoryId, syncNow]);

  const submitHeat = useCallback(
    async (values: unknown) => {
      const enqueue = async () => {
        await store().put({ id: newQueueId(), userId, factoryId, createdAt: Date.now(), values, status: "PENDING" });
        await refresh();
        return { queued: true } as const;
      };
      if (!navigator.onLine) return enqueue();
      try {
        return { queued: false, result: await createHeatAction(values) };
      } catch {
        // The request never completed (connection dropped): keep the heat on this device.
        return enqueue();
      }
    },
    [userId, factoryId, refresh],
  );

  const discard = useCallback(
    async (id: string) => {
      await store().remove(id);
      await refresh();
    },
    [refresh],
  );

  const value = useMemo(() => ({ timeZone, online, items, syncing, submitHeat, syncNow, discard }), [timeZone, online, items, syncing, submitHeat, syncNow, discard]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
