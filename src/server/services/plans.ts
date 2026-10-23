import { and, asc, desc, eq, lt } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db/client";
import { heats, mouldEvents, plannedHeats, productionOrders, productionPlans, recommendations } from "@/db/schema";
import { isIsoDate, localDayStart, localToUtc } from "@/domain/time";
import type { Actor } from "../context";
import { requirePerm } from "../context";
import { audit } from "../audit";
import { AppError, conflict, notFound, validation } from "../errors";
import { newId } from "../ids";
import { requireFurnace } from "./common";

export interface PlanDetail {
  plan: typeof productionPlans.$inferSelect;
  orders: (typeof productionOrders.$inferSelect)[];
  heats: (typeof plannedHeats.$inferSelect & { mouldReadyMin: number | null; orderCode: string | null })[];
}

export async function listPlans(db: DB, actor: Actor) {
  requirePerm(actor, "view");
  return db.select().from(productionPlans).where(eq(productionPlans.factoryId, actor.factory.id)).orderBy(desc(productionPlans.planDate));
}

export async function getPlan(db: DB, actor: Actor, planId?: string | null): Promise<PlanDetail | null> {
  requirePerm(actor, "view");
  const f = actor.factory;
  const plan = planId
    ? await db.query.productionPlans.findFirst({ where: and(eq(productionPlans.id, planId), eq(productionPlans.factoryId, f.id)) })
    : await db.query.productionPlans.findFirst({ where: eq(productionPlans.factoryId, f.id), orderBy: desc(productionPlans.planDate) });
  if (!plan) return null;
  const [orders, ph, mould] = await Promise.all([
    db.select().from(productionOrders).where(eq(productionOrders.planId, plan.id)).orderBy(asc(productionOrders.code)),
    db.select().from(plannedHeats).where(eq(plannedHeats.planId, plan.id)).orderBy(asc(plannedHeats.sequence)),
    db
      .select()
      .from(mouldEvents)
      .where(and(eq(mouldEvents.factoryId, f.id), eq(mouldEvents.dayDate, plan.planDate), eq(mouldEvents.kind, "PLANNED"))),
  ]);
  const dayStart = localDayStart(plan.planDate, f.timeZone);
  const mouldBySet = new Map(mould.map((m) => [m.mouldSet, Math.round((m.readyAt - dayStart) / 60000)]));
  return {
    plan,
    orders,
    heats: ph.map((h) => ({
      ...h,
      mouldReadyMin: h.mouldSet !== null ? (mouldBySet.get(h.mouldSet) ?? null) : null,
      orderCode: orders.find((o) => o.id === h.orderId)?.code ?? null,
    })),
  };
}

const minute = z.number().int().min(0).max(1440);

export const planUpdateSchema = z
  .object({
    planId: z.string().min(1),
    expectedRevision: z.number().int().min(1),
    deadlineMin: minute,
    currentPracticeStartMin: minute,
    downtime: z
      .array(z.object({ fromMin: minute, toMin: minute, reason: z.string().trim().min(1).max(80) }))
      .max(6)
      .refine((d) => d.every((x) => x.toMin > x.fromMin), "Each downtime block must end after it starts."),
    orders: z.array(z.object({ id: z.string(), requiredTonnes: z.number().positive().max(100), dueMin: minute })).max(20),
    mould: z.array(z.object({ mouldSet: z.number().int().min(1).max(100), readyMin: minute.nullable() })).max(60),
  })
  .strict();

export type PlanUpdate = z.infer<typeof planUpdateSchema>;

/** Mark pending recommendations for a plan as stale: their inputs no longer match. */
async function staleRecommendations(tx: Pick<DB, "update">, planId: string) {
  await tx
    .update(recommendations)
    .set({ status: "STALE" })
    .where(and(eq(recommendations.planId, planId), eq(recommendations.status, "PENDING")));
}

export async function updatePlan(db: DB, actor: Actor, raw: unknown) {
  requirePerm(actor, "plan.write");
  const parsed = planUpdateSchema.safeParse(raw);
  if (!parsed.success) throw validation(parsed.error.issues[0]?.message ?? "Invalid plan input.");
  const input = parsed.data;
  const f = actor.factory;
  const detail = await getPlan(db, actor, input.planId);
  if (!detail) throw notFound("Plan");
  if (detail.plan.revision !== input.expectedRevision) {
    throw new AppError("STALE", "Someone else changed this plan. Reload to see the latest inputs.");
  }
  const dayStart = localDayStart(detail.plan.planDate, f.timeZone);
  await db.transaction(async (tx) => {
    const res = await tx
      .update(productionPlans)
      .set({
        deadlineMin: input.deadlineMin,
        currentPracticeStartMin: input.currentPracticeStartMin,
        downtime: input.downtime,
        revision: detail.plan.revision + 1,
        updatedAt: Date.now(),
      })
      .where(and(eq(productionPlans.id, detail.plan.id), eq(productionPlans.revision, input.expectedRevision)));
    if (res.rowsAffected !== 1) throw conflict("The plan changed while saving. Reload and try again.");
    for (const o of input.orders) {
      if (!detail.orders.some((x) => x.id === o.id)) throw validation("Unknown order.");
      await tx.update(productionOrders).set({ requiredTonnes: o.requiredTonnes, dueMin: o.dueMin }).where(and(eq(productionOrders.id, o.id), eq(productionOrders.planId, detail.plan.id)));
    }
    for (const m of input.mould) {
      await tx
        .delete(mouldEvents)
        .where(and(eq(mouldEvents.factoryId, f.id), eq(mouldEvents.dayDate, detail.plan.planDate), eq(mouldEvents.kind, "PLANNED"), eq(mouldEvents.mouldSet, m.mouldSet)));
      if (m.readyMin !== null) {
        await tx.insert(mouldEvents).values({
          id: newId("mld"),
          factoryId: f.id,
          dayDate: detail.plan.planDate,
          kind: "PLANNED",
          mouldSet: m.mouldSet,
          readyAt: dayStart + m.readyMin * 60000,
          provenance: detail.plan.provenance,
        });
      }
    }
    await staleRecommendations(tx, detail.plan.id);
    await audit(tx, actor, "plan.update", "production_plan", detail.plan.id, {
      revision: detail.plan.revision + 1,
      deadlineMin: input.deadlineMin,
      downtime: input.downtime,
    });
  });
}

export const planCreateSchema = z.object({
  planDate: z.string().refine(isIsoDate, "Use a valid date."),
  heatsCount: z.number().int().min(1).max(30),
  chargeKg: z.number().positive(),
  orderCode: z.string().trim().min(1).max(30),
  grade: z.string().trim().min(1).max(40),
  deadlineMin: minute,
});

/** Create a plan for a real (non-simulation) factory: one order, N heats, no mould times yet. */
export async function createPlan(db: DB, actor: Actor, raw: unknown) {
  requirePerm(actor, "plan.write");
  const parsed = planCreateSchema.safeParse(raw);
  if (!parsed.success) throw validation(parsed.error.issues[0]?.message ?? "Invalid plan.");
  const input = parsed.data;
  const f = actor.factory;
  const furnace = await requireFurnace(db, f.id);
  if (input.chargeKg > furnace.capacityKg) throw validation(`Charge cannot exceed furnace capacity (${furnace.capacityKg} kg).`, { chargeKg: "Above capacity" });
  const exists = await db.query.productionPlans.findFirst({
    where: and(eq(productionPlans.factoryId, f.id), eq(productionPlans.planDate, input.planDate)),
  });
  if (exists) throw conflict("A plan for this date already exists.");
  const planId = newId("pln");
  const orderId = newId("ord");
  await db.transaction(async (tx) => {
    await tx.insert(productionPlans).values({
      id: planId,
      factoryId: f.id,
      furnaceId: furnace.id,
      planDate: input.planDate,
      deadlineMin: input.deadlineMin,
      currentPracticeStartMin: furnace.availableFromMin,
      downtime: [],
      provenance: f.isSimulation ? "SIMULATED" : "MANUAL",
      updatedAt: Date.now(),
    });
    await tx.insert(productionOrders).values({
      id: orderId,
      factoryId: f.id,
      planId,
      code: input.orderCode,
      grade: input.grade,
      requiredTonnes: Math.round(((input.heatsCount * input.chargeKg) / 1000) * 1000) / 1000,
      dueMin: input.deadlineMin,
    });
    for (let k = 0; k < input.heatsCount; k++) {
      await tx.insert(plannedHeats).values({
        id: newId("phe"),
        factoryId: f.id,
        planId,
        sequence: k + 1,
        heatNo: `H${String(k + 1).padStart(2, "0")}`,
        orderId,
        chargeKg: input.chargeKg,
        pouredKg: input.chargeKg,
        mouldSet: k + 1,
      });
    }
    await audit(tx, actor, "plan.create", "production_plan", planId, { planDate: input.planDate, heats: input.heatsCount });
  });
  return planId;
}

/** The day the optimiser uses as its data-quality reference: the latest as-run day before the plan. */
export async function referenceDay(db: DB, actor: Actor, planDate: string): Promise<string | null> {
  const row = await db
    .select({ d: heats.dayDate })
    .from(heats)
    .where(and(eq(heats.factoryId, actor.factory.id), lt(heats.dayDate, planDate)))
    .orderBy(desc(heats.dayDate))
    .limit(1);
  return row[0]?.d ?? null;
}

export function minuteOf(date: string, ts: number, tz: string): number {
  return Math.round((ts - localToUtc(date, 0, tz)) / 60000);
}
