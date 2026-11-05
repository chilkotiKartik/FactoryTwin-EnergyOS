/**
 * Offline queue for new heats logged on a tablet without a connection.
 *
 * Items are tied to the user and factory that created them and are only ever
 * sent by that same user in that same factory, so a shared tablet never
 * attributes one person's heat to another. The queue holds heat entries only;
 * it never holds credentials.
 */
export interface QueuedHeat {
  id: string;
  userId: string;
  factoryId: string;
  createdAt: number;
  values: unknown;
  status: "PENDING" | "REJECTED";
  message?: string;
}

export interface QueueStore {
  list(): Promise<QueuedHeat[]>;
  put(item: QueuedHeat): Promise<void>;
  remove(id: string): Promise<void>;
}

export function createMemoryStore(): QueueStore {
  const m = new Map<string, QueuedHeat>();
  return {
    list: async () => [...m.values()].sort((a, b) => a.createdAt - b.createdAt),
    put: async (i) => void m.set(i.id, i),
    remove: async (id) => void m.delete(id),
  };
}

const DB = "energyos-offline";
const STORE = "heats";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const r = fn(t.objectStore(STORE));
        t.oncomplete = () => {
          db.close();
          resolve(r.result);
        };
        t.onerror = t.onabort = () => {
          db.close();
          reject(t.error);
        };
      }),
  );
}

/** IndexedDB-backed store; falls back to memory where IndexedDB is unavailable (private mode, old browsers). */
export function createBrowserStore(): QueueStore {
  if (typeof indexedDB === "undefined") return createMemoryStore();
  return {
    list: async () => ((await tx<QueuedHeat[]>("readonly", (s) => s.getAll())) ?? []).sort((a, b) => a.createdAt - b.createdAt),
    put: async (i) => void (await tx("readwrite", (s) => s.put(i))),
    remove: async (id) => void (await tx("readwrite", (s) => s.delete(id))),
  };
}

export type SendResult = { kind: "ok" } | { kind: "rejected"; message: string } | { kind: "retry" };

export interface FlushSummary {
  sent: number;
  rejected: number;
  /** True when sending stopped because the connection or session is not usable yet. */
  stopped: boolean;
}

/**
 * Send this user's pending items oldest-first. Stops at the first item that
 * cannot be sent for a transient reason, so order is preserved. Items the server
 * refuses are kept as REJECTED for the user to read and discard; they are not retried.
 */
export async function flushQueue(store: QueueStore, who: { userId: string; factoryId: string }, send: (item: QueuedHeat) => Promise<SendResult>): Promise<FlushSummary> {
  const out: FlushSummary = { sent: 0, rejected: 0, stopped: false };
  const mine = (await store.list()).filter((i) => i.userId === who.userId && i.factoryId === who.factoryId && i.status === "PENDING");
  for (const item of mine) {
    let r: SendResult;
    try {
      r = await send(item);
    } catch {
      r = { kind: "retry" };
    }
    if (r.kind === "ok") {
      await store.remove(item.id);
      out.sent++;
    } else if (r.kind === "rejected") {
      await store.put({ ...item, status: "REJECTED", message: r.message });
      out.rejected++;
    } else {
      out.stopped = true;
      break;
    }
  }
  return out;
}

/** Map a server action result to a queue outcome. */
export function classify(res: { ok: boolean; code?: string; message?: string }): SendResult {
  if (res.ok) return { kind: "ok" };
  if (res.code === "UNAUTHENTICATED" || res.code === "INTERNAL" || res.code === "PAUSED") return { kind: "retry" };
  return { kind: "rejected", message: res.message ?? "Rejected." };
}

export function newQueueId(): string {
  return `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
