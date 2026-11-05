import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./schema";

export type DB = LibSQLDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __energyosDb?: { client: Client; db: DB; url: string } };

export function databaseUrl(): string {
  return process.env.DATABASE_URL ?? "file:./data/energyos.db";
}

/** Auth token for a hosted libSQL / Turso database. Not used for file: URLs. */
export function databaseAuthToken(): string | undefined {
  return process.env.DATABASE_AUTH_TOKEN || undefined;
}

export function createDb(url: string, authToken: string | undefined = databaseAuthToken()): { client: Client; db: DB } {
  const client = createClient(url.startsWith("file:") ? { url } : { url, authToken });
  return { client, db: drizzle(client, { schema }) };
}

/** Process-wide connection (reused across hot reloads in development). */
export function getDb(): DB {
  const url = databaseUrl();
  if (!globalForDb.__energyosDb || globalForDb.__energyosDb.url !== url) {
    const { client, db } = createDb(url);
    globalForDb.__energyosDb = { client, db, url };
    // Per-connection settings for a local file. A hosted database manages its own, and may refuse them;
    // never let that become an unhandled rejection.
    if (url.startsWith("file:")) {
      for (const pragma of ["PRAGMA foreign_keys = ON", "PRAGMA busy_timeout = 5000"]) client.execute(pragma).catch((e) => console.warn(`[energyos] ${pragma} failed`, e));
    }
  }
  return globalForDb.__energyosDb.db;
}

/** The process-wide connection if it is already open; never opens one. */
export function existingDb(): DB | null {
  return globalForDb.__energyosDb?.db ?? null;
}

export function getClient(): Client {
  getDb();
  return globalForDb.__energyosDb!.client;
}
