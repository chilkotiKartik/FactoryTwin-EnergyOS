import { and, eq, isNotNull, lt, lte, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { factories, sessions } from "@/db/schema";
import type { Actor } from "../context";
import { analyseFactory } from "./analysis";

/** Delay before re-analysing after new meter data; batches a burst of ingest calls into one run. */
export const ANALYSIS_DEBOUNCE_MS = Number(process.env.ANALYSIS_DEBOUNCE_MS ?? 60_000);

/** Run the analysis for a factory as the system (no user acted). */
export async function analyseAsSystem(db: DB, factoryId: string, reason: string) {
  const factory = await db.query.factories.findFirst({ where: eq(factories.id, factoryId) });
  if (!factory) return null;
  const system: Actor = { userId: "system", name: "system", email: "", role: "OWNER", factory, memberships: [] };
  return analyseFactory(db, system, reason);
}

// --- Durable analysis queue ---------------------------------------------------
// New data marks the factory (factories.analysis_requested_at). Whichever process
// gets there first claims the mark with one conditional update and runs the
// analysis; nothing is lost if a server restarts or sleeps, and two instances
// never analyse the same request twice.

/** Ask for a re-analysis of a factory, keeping the earliest outstanding request time. */
export async function requestAnalysis(db: DB, factoryId: string, now = Date.now()) {
  await db
    .update(factories)
    .set({ analysisRequestedAt: sql`coalesce(${factories.analysisRequestedAt}, ${now})` })
    .where(eq(factories.id, factoryId));
}

/** Claim and run every request older than `debounceMs`. Returns the factories analysed. */
export async function runPendingAnalyses(db: DB, debounceMs = ANALYSIS_DEBOUNCE_MS, now = Date.now()): Promise<string[]> {
  const due = await db
    .select({ id: factories.id, at: factories.analysisRequestedAt })
    .from(factories)
    .where(and(isNotNull(factories.analysisRequestedAt), lte(factories.analysisRequestedAt, now - debounceMs)));
  const done: string[] = [];
  for (const f of due) {
    const claimed = await db
      .update(factories)
      .set({ analysisRequestedAt: null })
      .where(and(eq(factories.id, f.id), eq(factories.analysisRequestedAt, f.at!)))
      .returning({ id: factories.id });
    if (!claimed.length) continue; // another instance took it, or newer data re-marked it
    try {
      await analyseAsSystem(db, f.id, "meter.ingest");
      done.push(f.id);
    } catch (e) {
      // Put the request back so the next tick retries it.
      await requestAnalysis(db, f.id, f.at!);
      throw e;
    }
  }
  return done;
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Record that a factory needs analysis, and (fast path) run it in this process after
 * the debounce. The periodic tick also picks up anything still marked.
 */
export function scheduleAnalysis(db: DB, factoryId: string, delayMs = ANALYSIS_DEBOUNCE_MS) {
  const marked = requestAnalysis(db, factoryId);
  const t = timers.get(factoryId);
  if (t) clearTimeout(t);
  const timer = setTimeout(() => {
    timers.delete(factoryId);
    void marked
      .then(() => runPendingAnalyses(db, delayMs))
      .catch((e) => console.error("[energyos] background analysis failed", e));
  }, delayMs);
  timer.unref?.();
  timers.set(factoryId, timer);
  return marked;
}

/** Run a factory's outstanding analysis now (tests, shutdown), ignoring the debounce. */
export async function flushAnalysis(db: DB, factoryId: string) {
  const t = timers.get(factoryId);
  if (t) {
    clearTimeout(t);
    timers.delete(factoryId);
  }
  await runPendingAnalyses(db, 0);
}

// --- Periodic work ---------------------------------------------------------------

export interface TickReport {
  sealed: boolean;
  meterHealth: boolean;
  analyses: string[];
  market: string;
  durationMs: number;
}

/**
 * Everything periodic, once. Called by the in-process timers below and by
 * POST /api/cron/tick, so an external scheduler can drive a sleeping or serverless host.
 */
export async function runTick(db: DB): Promise<TickReport> {
  const t0 = Date.now();
  const [{ sealAuditChain }, { checkMeterHealth }, { pruneLimits }, { marketFeedEnabled, refreshIexDam }] = await Promise.all([
    import("../audit"),
    import("./alerts"),
    import("./limits"),
    import("./market"),
  ]);
  const report: TickReport = { sealed: false, meterHealth: false, analyses: [], market: "off", durationMs: 0 };
  const step = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      console.error(`[energyos] tick ${name} failed`, e);
    }
  };
  await step("analysis", async () => {
    report.analyses = await runPendingAnalyses(db);
  });
  await step("audit-seal", async () => {
    await sealAuditChain(db);
    report.sealed = true;
  });
  await step("meter-health", async () => {
    await checkMeterHealth(db);
    report.meterHealth = true;
  });
  await step("cleanup", async () => {
    await db.delete(sessions).where(lt(sessions.expiresAt, Date.now()));
    await pruneLimits(db);
  });
  if (marketFeedEnabled()) {
    await step("market", async () => {
      const r = await refreshIexDam(db);
      report.market = r.ok ? `updated ${r.date}` : r.reason;
    });
  }
  report.durationMs = Date.now() - t0;
  return report;
}

let started = false;

/** In-process schedule for a long-running server (ENERGYOS_JOBS=false turns it off). */
export function startBackgroundJobs() {
  if (started) return;
  started = true;
  void (async () => {
    const [{ getDb }, { sealAuditChain }] = await Promise.all([import("@/db/client"), import("../audit")]);
    const every = (ms: number, name: string, fn: () => Promise<unknown>) => {
      const t = setInterval(() => void fn().catch((e) => console.error(`[energyos] job ${name} failed`, e)), ms);
      t.unref?.();
    };
    every(30_000, "audit-seal", () => sealAuditChain(getDb()));
    every(60_000, "analysis-queue", () => runPendingAnalyses(getDb()));
    // The rest (meter health, cleanup, IEX prices) runs with the tick: shortly after start, then every 10 minutes.
    const tick = () => runTick(getDb());
    const first = setTimeout(() => void tick().catch((e) => console.error("[energyos] first tick failed", e)), 15_000);
    first.unref?.();
    every(10 * 60_000, "tick", tick);
  })();
}
