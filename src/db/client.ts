import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./schema";

export type DB = LibSQLDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __energyosDb?: { client: Client; db: DB; url: string } };

/**
 * DATABASE_URL wins. On Vercel without one, each server instance copies the
 * seed database built at deploy time into /tmp: a public demo whose changes
 * are not durable and reset on cold start. Set DATABASE_URL (plus
 * DATABASE_AUTH_TOKEN for a hosted libSQL/Turso database) for persistence.
 */
export function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (process.env.VERCEL) return ephemeralCopyOfSeed();
  return "file:./data/energyos.db";
}

export function isEphemeralDemoDb(): boolean {
  return !process.env.DATABASE_URL && !!process.env.VERCEL;
}

function ephemeralCopyOfSeed(): string {
  const target = "/tmp/energyos.db";
  if (!existsSync(target)) copyFileSync(path.join(process.cwd(), "data", "seed.db"), target);
  return `file:${target}`;
}

export function createDb(url: string): { client: Client; db: DB } {
  const client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN || undefined });
  return { client, db: drizzle(client, { schema }) };
}

/** Process-wide connection (reused across hot reloads in development). */
export function getDb(): DB {
  const url = databaseUrl();
  if (!globalForDb.__energyosDb || globalForDb.__energyosDb.url !== url) {
    const { client, db } = createDb(url);
    globalForDb.__energyosDb = { client, db, url };
    void client.execute("PRAGMA foreign_keys = ON");
    if (url.startsWith("file:")) void client.execute("PRAGMA busy_timeout = 5000");
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
