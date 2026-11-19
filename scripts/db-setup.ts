/**
 * Create / migrate the database and seed the demo.
 *   pnpm db:setup            migrate + seed (idempotent; keeps existing data)
 *   pnpm db:setup --reset    delete the database file first
 *   --standalone             checkpoint the WAL so the file can be copied alone (Vercel seed)
 */
import { existsSync, rmSync } from "node:fs";
import { runMigrations } from "../src/db/migrate";
import { seedAll } from "../src/server/bootstrap";

async function main() {
  const url = process.env.DATABASE_URL ?? "file:./data/energyos.db";
  if (process.argv.includes("--reset") && url.startsWith("file:")) {
    for (const suffix of ["", "-wal", "-shm", "-journal"]) {
      const f = url.slice(5) + suffix;
      if (existsSync(f)) rmSync(f);
    }
    console.log("Removed existing database.");
  }
  const t0 = Date.now();
  const { db, client } = await runMigrations(url);
  console.log(`Migrations applied (${url}).`);
  const res = await seedAll(db, {
    demoPassword: process.env.DEMO_PASSWORD ?? "energyos-demo",
    seedDemoUsers: (process.env.SEED_DEMO_USERS ?? "true") !== "false",
  });
  console.log(res.created ? `Seeded demo factory and scenario "holding-anomaly" in ${Date.now() - t0} ms.` : "Base data already present; nothing seeded.");
  if (process.argv.includes("--standalone") && url.startsWith("file:")) {
    // Fold the WAL back into the main file so it can be shipped as one file.
    await client.execute("PRAGMA wal_checkpoint(TRUNCATE)");
    await client.execute("PRAGMA journal_mode = DELETE");
    console.log("Database written as a single standalone file.");
  }
  client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
