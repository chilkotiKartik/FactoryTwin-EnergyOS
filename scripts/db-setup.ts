/**
 * Create / migrate the database and seed the demo.
 *   pnpm db:setup            migrate + seed (idempotent; keeps existing data)
 *   pnpm db:setup --reset    local PGlite only: delete the data directory first
 * DATABASE_URL: postgres://… for a server, or pglite:<dir> (default pglite:./data/pglite) locally.
 */
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { databaseUrl } from "../src/db/client";
import { runMigrations } from "../src/db/migrate";
import { seedAll } from "../src/server/bootstrap";

async function main() {
  const url = databaseUrl();
  const safe = url.replace(/\/\/[^@/]*@/, "//***@");
  if (process.argv.includes("--reset")) {
    if (!url.startsWith("pglite:")) throw new Error("--reset only deletes a local PGlite directory. Drop a server database yourself.");
    const dir = path.resolve(url.slice("pglite:".length));
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    console.log("Removed existing local database.");
  }
  const t0 = Date.now();
  const h = await runMigrations(url);
  console.log(`Migrations applied (${safe}).`);
  const res = await seedAll(h.db, {
    demoPassword: process.env.DEMO_PASSWORD ?? "energyos-demo",
    seedDemoUsers: (process.env.SEED_DEMO_USERS ?? "true") !== "false",
  });
  console.log(res.created ? `Seeded demo factory and scenario "holding-anomaly" in ${Date.now() - t0} ms.` : "Base data already present; nothing seeded.");
  await h.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
