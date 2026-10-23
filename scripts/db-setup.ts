/**
 * Create / migrate the database and seed the demo.
 *   pnpm db:setup            migrate + seed (idempotent; keeps existing data)
 *   pnpm db:setup --reset    delete the database file first
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
  client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
