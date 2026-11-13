import path from "node:path";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { createDb, type DbHandle } from "./client";

const MIGRATIONS = path.resolve(process.cwd(), "drizzle");

/** Open a database and bring its schema up to date. Safe to run on every start. */
export async function runMigrations(url: string): Promise<DbHandle> {
  const h = createDb(url);
  if (h.kind === "pglite") await migratePglite(h.db as unknown as PgliteDatabase, { migrationsFolder: MIGRATIONS });
  else await migratePostgres(h.db as unknown as PostgresJsDatabase, { migrationsFolder: MIGRATIONS });
  return h;
}
