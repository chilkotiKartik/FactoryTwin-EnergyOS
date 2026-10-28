import { eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { factories } from "@/db/schema";
import type { Actor } from "../context";
import { analyseFactory } from "./analysis";

/** Delay before re-analysing after new meter data; batches a burst of ingest calls into one run. */
export const ANALYSIS_DEBOUNCE_MS = Number(
  process.env.ANALYSIS_DEBOUNCE_MS ?? 60_000,
);

const pending = new Map<string, ReturnType<typeof setTimeout>>();
const running = new Map<string, Promise<unknown>>();

/** Run the analysis for a factory as the system (no user acted). */
export async function analyseAsSystem(
  db: DB,
  factoryId: string,
  reason: string,
) {
  const factory = await db.query.factories.findFirst({
    where: eq(factories.id, factoryId),
  });
  if (!factory) return null;
  const system: Actor = {
    userId: "system",
    name: "system",
    email: "",
    role: "OWNER",
    factory,
    memberships: [],
  };
  return analyseFactory(db, system, reason);
}

/**
 * Debounced, per-factory background analysis. In-process: fine for the single
 * Node server this app targets. A multi-instance deployment needs a shared queue.
 */
export function scheduleAnalysis(
  db: DB,
  factoryId: string,
  delayMs = ANALYSIS_DEBOUNCE_MS,
) {
  const t = pending.get(factoryId);
  if (t) clearTimeout(t);
  pending.set(
    factoryId,
    setTimeout(() => {
      pending.delete(factoryId);
      const prev = running.get(factoryId) ?? Promise.resolve();
      const next = prev
        .then(() => analyseAsSystem(db, factoryId, "meter.ingest"))
        .catch((e) => console.error("[energyos] background analysis failed", e))
        .finally(() => {
          if (running.get(factoryId) === next) running.delete(factoryId);
        });
      running.set(factoryId, next);
    }, delayMs),
  );
}

/** Run a scheduled analysis now instead of waiting (tests, shutdown), then wait for it. */
export async function flushAnalysis(db: DB, factoryId: string) {
  const t = pending.get(factoryId);
  if (t) {
    clearTimeout(t);
    pending.delete(factoryId);
    const next = (running.get(factoryId) ?? Promise.resolve()).then(() =>
      analyseAsSystem(db, factoryId, "meter.ingest"),
    );
    running.set(factoryId, next);
  }
  await running.get(factoryId);
  running.delete(factoryId);
}

let started = false;

/**
 * Periodic upkeep for the single server process: seal audit events into the
 * hash chain, raise meter-offline alerts, delete expired sessions.
 */
export function startBackgroundJobs() {
  if (started) return;
  started = true;
  const every = (ms: number, name: string, fn: () => Promise<unknown>) => {
    const t = setInterval(() => void fn().catch((e) => console.error(`[energyos] job ${name} failed`, e)), ms);
    t.unref?.();
  };
  void (async () => {
    const [{ getDb }, { sealAuditChain }, { checkMeterHealth }, { sessions }, { lt }] = await Promise.all([
      import("@/db/client"),
      import("../audit"),
      import("./alerts"),
      import("@/db/schema"),
      import("drizzle-orm"),
    ]);
    every(30_000, "audit-seal", () => sealAuditChain(getDb()));
    every(5 * 60_000, "meter-health", () => checkMeterHealth(getDb()));
    every(60 * 60_000, "session-cleanup", () => getDb().delete(sessions).where(lt(sessions.expiresAt, Date.now())));
  })();
}
