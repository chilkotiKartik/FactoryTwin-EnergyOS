import { eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { factories } from "@/db/schema";
import type { Actor } from "./context";
import { resolveActor } from "./context";
import { resetScenario, seedBase } from "./services/demo";

/** Seed base records and the default scenario. Used by `pnpm db:seed` and tests. */
export async function seedAll(db: DB, opts: { demoPassword: string; seedDemoUsers: boolean; scenario?: string }) {
  const base = await seedBase(db, opts);
  const factory = await db.query.factories.findFirst({ where: eq(factories.id, base.factoryAId) });
  if (!factory) throw new Error("Seed failed: simulation factory missing");
  let actor: Actor;
  try {
    actor = await resolveActor(db, "usr_owner_a", factory.id);
  } catch {
    // No demo users: act as the system with owner rights for the seed only.
    actor = { userId: "system", name: "system seed", email: "", role: "OWNER", factory, memberships: [] };
  }
  if (base.created || opts.scenario) await resetScenario(db, actor, opts.scenario ?? "holding-anomaly");
  return base;
}
