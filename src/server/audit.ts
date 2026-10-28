import { createHash } from "node:crypto";
import { and, asc, eq, isNull, isNotNull, desc, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { getDb } from "@/db/client";
import { auditEvents } from "@/db/schema";
import type { Actor } from "./context";

type Tx = Pick<DB, "insert">;
type AuditRow = typeof auditEvents.$inferSelect;

export async function audit(
  db: Tx,
  actor: (Pick<Actor, "userId" | "name"> & { factory: { id: string } }) | null,
  action: string,
  entity: string,
  entityId: string | null,
  details: Record<string, unknown> = {},
  factoryId?: string | null,
): Promise<void> {
  await db.insert(auditEvents).values({
    factoryId: factoryId ?? actor?.factory.id ?? null,
    actorId: actor?.userId ?? null,
    actorName: actor?.name ?? "system",
    action,
    entity,
    entityId,
    details,
    createdAt: Date.now(),
  });
  // Seal soon when written on the app's main connection. An event written inside a
  // transaction is not committed yet; the periodic sealer or the next verification
  // picks it up. (A transaction handle must never be reused after it closes.)
  if ((db as unknown) === getDb()) scheduleSeal(getDb());
}

// --- Hash chain -------------------------------------------------------------
// Events are often written inside the callers' transactions, so they are chained
// a moment later by a single sealer that walks unsealed rows in id order (SQLite
// serialises writers, so ids commit in order). Each
// factory (and the system, factoryId null) has its own chain. Editing, removing
// or reordering a sealed event breaks every later hash in that chain.

/** Stable JSON: object keys sorted, so the hash does not depend on key order. */
function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
    .join(",")}}`;
}

export function eventHash(prevHash: string | null, e: Pick<AuditRow, "id" | "factoryId" | "actorId" | "actorName" | "action" | "entity" | "entityId" | "details" | "createdAt">): string {
  const body = canonical({ id: e.id, factoryId: e.factoryId, actorId: e.actorId, actorName: e.actorName, action: e.action, entity: e.entity, entityId: e.entityId, details: e.details, createdAt: e.createdAt });
  return createHash("sha256").update(`${prevHash ?? "GENESIS"}\n${body}`).digest("hex");
}

const sealers = new Map<DB, Promise<void>>();
let sealTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSeal(db: DB) {
  if (sealTimer) return;
  sealTimer = setTimeout(() => {
    sealTimer = null;
    void sealAuditChain(db).catch((e) => console.error("[energyos] audit seal failed", e));
  }, 25);
}

/** Chain every committed, unsealed event. Serialised per database so two sealers never fork a chain. */
export function sealAuditChain(db: DB = getDb()): Promise<void> {
  const prev = sealers.get(db) ?? Promise.resolve();
  const next = prev.then(() => sealOnce(db));
  sealers.set(
    db,
    next.catch(() => undefined),
  );
  return next;
}

async function sealOnce(db: DB) {
  for (;;) {
    const batch = await db.select().from(auditEvents).where(isNull(auditEvents.hash)).orderBy(asc(auditEvents.id)).limit(500);
    if (!batch.length) return;
    const heads = new Map<string, string | null>();
    for (const e of batch) {
      const key = e.factoryId ?? "";
      if (!heads.has(key)) {
        const last = await db
          .select({ hash: auditEvents.hash })
          .from(auditEvents)
          .where(and(e.factoryId === null ? isNull(auditEvents.factoryId) : eq(auditEvents.factoryId, e.factoryId), isNotNull(auditEvents.hash), sql`${auditEvents.id} < ${e.id}`))
          .orderBy(desc(auditEvents.id))
          .limit(1);
        heads.set(key, last[0]?.hash ?? null);
      }
      const prevHash = heads.get(key) ?? null;
      const hash = eventHash(prevHash, e);
      await db.update(auditEvents).set({ prevHash, hash }).where(and(eq(auditEvents.id, e.id), isNull(auditEvents.hash)));
      heads.set(key, hash);
    }
  }
}

export interface ChainCheck {
  ok: boolean;
  checked: number;
  unsealed: number;
  firstBrokenId: number | null;
  message: string;
}

/** Re-compute a factory's chain from the start and report the first event that does not match. */
export async function verifyAuditChain(db: DB, factoryId: string | null): Promise<ChainCheck> {
  await sealAuditChain(db);
  const where = factoryId === null ? isNull(auditEvents.factoryId) : eq(auditEvents.factoryId, factoryId);
  let prev: string | null = null;
  let checked = 0;
  let unsealed = 0;
  let lastId = 0;
  for (;;) {
    const rows: AuditRow[] = await db.select().from(auditEvents).where(and(where, sql`${auditEvents.id} > ${lastId}`)).orderBy(asc(auditEvents.id)).limit(2000);
    if (!rows.length) break;
    for (const e of rows) {
      lastId = e.id;
      if (!e.hash) {
        unsealed++;
        continue;
      }
      if (e.prevHash !== prev || eventHash(prev, e) !== e.hash) {
        return { ok: false, checked, unsealed, firstBrokenId: e.id, message: `Audit chain broken at event #${e.id}: it was changed, or an earlier event was removed or altered.` };
      }
      prev = e.hash;
      checked++;
    }
  }
  return { ok: true, checked, unsealed, firstBrokenId: null, message: `${checked.toLocaleString("en-IN")} events verified; none altered or removed.` };
}
