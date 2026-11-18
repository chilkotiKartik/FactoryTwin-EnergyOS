import { eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { lockKey } from "@/db/lock";
import { factories, tariffVersions } from "@/db/schema";
import { MSEDCL_HT1A_FY27, msedclHt1aFy27 } from "@/domain/tariff-presets";
import type { Actor } from "./context";
import { resolveActor } from "./context";
import { resetScenario, seedBase } from "./services/demo";
import { createTariffVersion } from "./services/tariffs";

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
  await ensureReferenceTariffs(db);
  return base;
}

/**
 * Foundry B is a real (non-simulation) factory in Pune, Maharashtra: give it the
 * official MSEDCL HT I(A) Industry tariff for FY 2026-27 (both seasons) and the
 * order's demand charge, once, if it has no tariff yet. Idempotent and locked, so it
 * is safe on every start and on several instances.
 */
export async function ensureReferenceTariffs(db: DB) {
  await db.transaction(async (tx) => {
    await lockKey(tx, "reference-tariffs");
    const b = await tx.query.factories.findFirst({ where: eq(factories.id, "fac_foundry_b") });
    if (!b) return;
    const existing = await tx.select({ id: tariffVersions.id }).from(tariffVersions).where(eq(tariffVersions.factoryId, b.id)).limit(1);
    if (existing.length) return;
    const system: Actor = { userId: "system", name: "system seed", email: "", role: "OWNER", factory: b, memberships: [] };
    for (const p of msedclHt1aFy27(b.powerFactor)) {
      await createTariffVersion(tx as unknown as DB, system, {
        name: p.name,
        effectiveFrom: p.effectiveFrom,
        normalRate: p.normalRate,
        evidence: "VERIFIED",
        sourceNote: p.sourceNote,
        periods: p.periods,
      });
    }
    if (b.demandRatePaisePerKvaMonth === null) {
      await tx.update(factories).set({ demandRatePaisePerKvaMonth: MSEDCL_HT1A_FY27.demandRsPerKvaMonth * 100 }).where(eq(factories.id, b.id));
    }
  });
}
