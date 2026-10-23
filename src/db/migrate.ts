import path from "node:path";
import { mkdirSync } from "node:fs";
import { migrate } from "drizzle-orm/libsql/migrator";
import { createDb } from "./client";

export async function runMigrations(url: string) {
  if (url.startsWith("file:")) {
    const file = url.slice(5);
    if (file && !file.startsWith(":memory:")) mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }
  const { db, client } = createDb(url);
  await client.execute("PRAGMA journal_mode = WAL");
  await migrate(db, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  return { db, client };
}
