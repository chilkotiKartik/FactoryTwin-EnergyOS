import { mkdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * One database type for the whole app: PostgreSQL in production (postgres://…),
 * and PGlite — the same Postgres engine embedded in Node — for local development
 * and tests (pglite:./data/pglite, or pglite:memory), so nobody needs a database
 * server to run the project.
 */
export type DB = PgDatabase<PgQueryResultHKT, typeof schema, ExtractTablesWithRelations<typeof schema>>;

export interface DbHandle {
  db: DB;
  kind: "postgres" | "pglite";
  close(): Promise<void>;
}

export const DEFAULT_DATABASE_URL = "pglite:./data/pglite";

export function databaseUrl(): string {
  return process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
}

/** bigint (int8) and numeric arrive as strings by default; every value here is well inside 2^53. */
const toNumber = (v: string) => Number(v);

export function createDb(url: string): DbHandle {
  if (url.startsWith("pglite:")) {
    const where = url.slice("pglite:".length);
    const memory = where === "" || where === "memory" || where === ":memory:";
    if (!memory) mkdirSync(path.resolve(where), { recursive: true });
    const client = new PGlite(memory ? undefined : path.resolve(where), { parsers: { 20: toNumber, 1700: toNumber } });
    return { db: drizzlePglite({ client, schema }) as unknown as DB, kind: "pglite", close: () => client.close() };
  }
  const client = postgres(url, {
    max: Number(process.env.DB_POOL_MAX ?? 10),
    idle_timeout: 30,
    connect_timeout: 15,
    // Transaction-mode poolers (for example Supabase on port 6543) cannot use prepared statements.
    prepare: process.env.DB_PREPARE !== "false",
    types: {
      int8: { to: 20, from: [20], serialize: (v: number) => String(v), parse: toNumber },
      numeric: { to: 1700, from: [1700], serialize: (v: number) => String(v), parse: toNumber },
    },
    onnotice: () => {},
  });
  return { db: drizzlePostgres({ client, schema }) as unknown as DB, kind: "postgres", close: () => client.end({ timeout: 5 }) };
}

const g = globalThis as unknown as { __energyosDb?: { url: string; handle: DbHandle } };

function handle(): DbHandle {
  const url = databaseUrl();
  if (!g.__energyosDb || g.__energyosDb.url !== url) g.__energyosDb = { url, handle: createDb(url) };
  return g.__energyosDb.handle;
}

/** Process-wide connection pool (reused across hot reloads in development). */
export function getDb(): DB {
  return handle().db;
}

/** The process-wide database if it is already open; never opens one. */
export function existingDb(): DB | null {
  return g.__energyosDb?.handle.db ?? null;
}
