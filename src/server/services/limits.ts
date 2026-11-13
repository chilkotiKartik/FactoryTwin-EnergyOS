import { lt, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { rateLimits } from "@/db/schema";

export interface LimitResult {
  ok: boolean;
  count: number;
  resetAt: number;
}

/**
 * Count one hit against `key` in a fixed window, atomically, in the database, so
 * every server instance shares the same count (a single upsert statement: no race).
 */
export async function hitLimit(db: DB, key: string, max: number, windowMs: number, now = Date.now()): Promise<LimitResult> {
  const reset = now + windowMs;
  const rows = await db
    .insert(rateLimits)
    .values({ key: key.slice(0, 200), n: 1, resetAt: reset })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        n: sql`case when ${rateLimits.resetAt} <= ${now} then 1 else ${rateLimits.n} + 1 end`,
        resetAt: sql`case when ${rateLimits.resetAt} <= ${now} then ${reset} else ${rateLimits.resetAt} end`,
      },
    })
    .returning({ n: rateLimits.n, resetAt: rateLimits.resetAt });
  const r = rows[0];
  return { ok: r.n <= max, count: r.n, resetAt: r.resetAt };
}

/** Is `key` already over `max` in its current window? Reads only. */
export async function isLimited(db: DB, key: string, max: number, now = Date.now()): Promise<boolean> {
  const r = await db.query.rateLimits.findFirst({ where: (t, { eq }) => eq(t.key, key.slice(0, 200)) });
  return !!r && r.resetAt > now && r.n >= max;
}

export async function clearLimit(db: DB, key: string) {
  await db.delete(rateLimits).where(sql`${rateLimits.key} = ${key.slice(0, 200)}`);
}

/** Drop expired windows (run by the periodic job). */
export async function pruneLimits(db: DB, now = Date.now()) {
  await db.delete(rateLimits).where(lt(rateLimits.resetAt, now));
}
