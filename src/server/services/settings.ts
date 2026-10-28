import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db/client";
import { factories, furnaces, memberships, recommendations, users } from "@/db/schema";
import type { Actor } from "../context";
import { requirePerm } from "../context";
import { audit } from "../audit";
import { validation } from "../errors";
import { requireFurnace } from "./common";
import { analyseFactory } from "./analysis";

export const settingsSchema = z
  .object({
    holdingKw: z.number().min(0).max(1000),
    emissionFactor: z.number().min(0).max(2),
    emissionFactorSource: z.string().trim().min(3).max(300),
    turnaroundMinutes: z.number().int().min(0).max(120),
    coldGapMinutes: z.number().int().min(5).max(600),
    coldExtraMinutes: z.number().int().min(0).max(60),
    maxHoldMinutes: z.number().int().min(0).max(240),
    minCompletenessPct: z.number().min(50).max(100),
    gridMinutes: z.union([z.literal(1), z.literal(5), z.literal(10), z.literal(15)]),
    capacityKg: z.number().positive().max(50000),
    ratedKw: z.number().positive().max(50000),
    nominalMeltMinutes: z.number().int().min(5).max(600),
    availableFromMin: z.number().int().min(0).max(1439),
    availableToMin: z.number().int().min(1).max(1440),
    maxHeatsPerDay: z.number().int().min(1).max(60),
  })
  .refine((v) => v.availableToMin > v.availableFromMin, { message: "Availability must end after it starts.", path: ["availableToMin"] });

export async function getSettings(db: DB, actor: Actor) {
  requirePerm(actor, "view");
  const furnace = await requireFurnace(db, actor.factory.id);
  const team = await db
    .select({ name: users.name, email: users.email, role: memberships.role })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.factoryId, actor.factory.id));
  return { factory: actor.factory, furnace, team };
}

export async function updateSettings(db: DB, actor: Actor, raw: unknown) {
  requirePerm(actor, "factory.configure");
  const parsed = settingsSchema.safeParse(raw);
  if (!parsed.success) throw validation(parsed.error.issues[0]?.message ?? "Invalid settings.");
  const v = parsed.data;
  const furnace = await requireFurnace(db, actor.factory.id);
  await db.transaction(async (tx) => {
    await tx
      .update(factories)
      .set({
        holdingKw: v.holdingKw,
        emissionFactor: v.emissionFactor,
        emissionFactorSource: v.emissionFactorSource,
        turnaroundMinutes: v.turnaroundMinutes,
        coldGapMinutes: v.coldGapMinutes,
        coldExtraMinutes: v.coldExtraMinutes,
        maxHoldMinutes: v.maxHoldMinutes,
        minCompleteness: v.minCompletenessPct / 100,
        gridMinutes: v.gridMinutes,
      })
      .where(eq(factories.id, actor.factory.id));
    await tx
      .update(furnaces)
      .set({
        capacityKg: v.capacityKg,
        ratedKw: v.ratedKw,
        nominalMeltMinutes: v.nominalMeltMinutes,
        availableFromMin: v.availableFromMin,
        availableToMin: v.availableToMin,
        maxHeatsPerDay: v.maxHeatsPerDay,
      })
      .where(eq(furnaces.id, furnace.id));
    // Process parameters are optimiser inputs: pending advice no longer matches them.
    await tx.update(recommendations).set({ status: "STALE" }).where(and(eq(recommendations.factoryId, actor.factory.id), eq(recommendations.status, "PENDING")));
    await audit(tx, actor, "factory.configure", "factory", actor.factory.id, { settings: v });
  });
  // Holding power, rated power and melt time change how traces are segmented.
  const factory = await db.query.factories.findFirst({ where: eq(factories.id, actor.factory.id) });
  if (factory) await analyseFactory(db, { ...actor, factory }, "settings.update");
}
