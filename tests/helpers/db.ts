import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runMigrations } from "@/db/migrate";
import { seedAll } from "@/server/bootstrap";
import { resolveActor } from "@/server/context";
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

/** Fresh migrated + seeded database in a temp directory. */
export async function freshDb() {
  const dir = mkdtempSync(path.join(tmpdir(), "energyos-test-"));
  const url = `file:${path.join(dir, "test.db")}`;
  const { db, client } = await runMigrations(url);
  await client.execute("PRAGMA foreign_keys = ON");
  await seedAll(db, { demoPassword: "test-password", seedDemoUsers: true });
  const actor = (userId: string, factoryId = IDS.facA) => resolveActor(db, userId, factoryId);
  return {
    db: db as DB,
    client,
    url,
    actor,
    cleanup: () => {
      client.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
