import { sql } from "drizzle-orm";
import type { DB } from "./client";

/**
 * Serialise writers that check-then-write (overlap checks, "next version = max + 1",
 * approval freshness) for one key — usually a factory id. A transaction-scoped
 * Postgres advisory lock: released automatically at commit or rollback, so two
 * tablets or two server instances cannot interleave. Readers are never blocked.
 */
export async function lockKey(tx: Pick<DB, "execute">, key: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
}
