import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runMigrations } from "@/db/migrate";
import { seedAll } from "@/server/bootstrap";
import { resolveActor } from "@/server/context";
import postgres from "postgres";
import type { DB } from "@/db/client";

export const IDS = {
  facA: "fac_foundry_a_sim",
  facB: "fac_foundry_b",
  ownerA: "usr_owner_a",
  supervisorA: "usr_supervisor_a",
  operatorA: "usr_operator_a",
  analystA: "usr_analyst_a",
  ownerB: "usr_owner_b",
};

/**
 * Fresh migrated + seeded database for one test file.
 * Default: PGlite (embedded Postgres) in a temp directory.
 * With TEST_DATABASE_URL=postgres://…/anydb, a throwaway database is created on that
 * server instead, so the suite also runs against real PostgreSQL and the production driver.
 */
export async function freshDb() {
  const server = process.env.TEST_DATABASE_URL;
  let url: string;
  let drop: () => Promise<void>;
  let dir: string | null = null;
  if (server) {
    const name = `energyos_t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const admin = postgres(server, { max: 1, onnotice: () => {} });
    await admin.unsafe(`create database ${name}`);
    await admin.end();
    const u = new URL(server);
    u.pathname = `/${name}`;
    url = u.toString();
    drop = async () => {
      const a = postgres(server, { max: 1, onnotice: () => {} });
      await a.unsafe(`drop database if exists ${name} with (force)`);
      await a.end();
    };
  } else {
    dir = mkdtempSync(path.join(tmpdir(), "energyos-test-"));
    url = `pglite:${dir}`;
    drop = async () => rmSync(dir!, { recursive: true, force: true });
  }
  const h = await runMigrations(url);
  await seedAll(h.db, { demoPassword: "test-password", seedDemoUsers: true });
  const actor = (userId: string, factoryId = IDS.facA) => resolveActor(h.db, userId, factoryId);
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await h.close();
  };
  return {
    db: h.db as DB,
    url,
    dir,
    kind: h.kind,
    actor,
    close,
    cleanup: async () => {
      await close().catch(() => {});
      await drop();
    },
  };
}
