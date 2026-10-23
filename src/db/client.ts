import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./schema";

export type DB = LibSQLDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __energyosDb?: { client: Client; db: DB; url: string } };

export function databaseUrl(): string {
  return process.env.DATABASE_URL ?? "file:./data/energyos.db";
}

export function createDb(url: string): { client: Client; db: DB } {
  const client = createClient({ url });
  return { client, db: drizzle(client, { schema }) };
}

/** Process-wide connection (reused across hot reloads in development). */
export function getDb(): DB {
  const url = databaseUrl();
  if (!globalForDb.__energyosDb || globalForDb.__energyosDb.url !== url) {
    const { client, db } = createDb(url);
    globalForDb.__energyosDb = { client, db, url };
    void client.execute("PRAGMA foreign_keys = ON");
    void client.execute("PRAGMA busy_timeout = 5000");
  }
  return globalForDb.__energyosDb.db;
}

export function getClient(): Client {
  getDb();
  return globalForDb.__energyosDb!.client;
}
