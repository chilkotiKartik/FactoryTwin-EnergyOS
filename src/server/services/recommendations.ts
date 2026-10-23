import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db/client";
import { approvals, optimizationRuns, productionPlans, recommendations, scheduleItems, scheduleVersions, users } from "@/db/schema";
import type { Actor } from "../context";
import { requirePerm } from "../context";
import { audit } from "../audit";
import { AppError, conflict, notFound, validation } from "../errors";
import { newId } from "../ids";
import { buildInput } from "./optimization";

export async function listRecommendations(db: DB, actor: Actor) {
  requirePerm(actor, "view");
  const rows = await db
    .select({ r: recommendations, plan: productionPlans })
    .from(recommendations)
    .innerJoin(productionPlans, eq(productionPlans.id, recommendations.planId))
    .where(eq(recommendations.factoryId, actor.factory.id))
    .orderBy(desc(recommendations.createdAt))
    .limit(100);
  const ids = rows.map((x) => x.r.id);
  const decided = ids.length
    ? await db
        .select({ a: approvals, name: users.name })
        .from(approvals)
        .leftJoin(users, eq(users.id, approvals.actorId))
        .where(inArray(approvals.recommendationId, ids))
    : [];
  return rows.map(({ r, plan }) => ({ ...r, planDate: plan.planDate, decision: decided.find((d) => d.a.recommendationId === r.id) ?? null }));
}

export async function getRecommendation(db: DB, actor: Actor, id: string) {
  requirePerm(actor, "view");
  const r = await db.query.recommendations.findFirst({ where: and(eq(recommendations.id, id), eq(recommendations.factoryId, actor.factory.id)) });
  if (!r) return null;
  const [plan, run, proposed, current, approval] = await Promise.all([
    db.query.productionPlans.findFirst({ where: eq(productionPlans.id, r.planId) }),
    db.query.optimizationRuns.findFirst({ where: eq(optimizationRuns.id, r.optimizationRunId) }),
    db.select().from(scheduleItems).where(eq(scheduleItems.scheduleVersionId, r.proposedScheduleId)).orderBy(asc(scheduleItems.sequence)),
    db.select().from(scheduleItems).where(eq(scheduleItems.scheduleVersionId, r.currentScheduleId)).orderBy(asc(scheduleItems.sequence)),
    db
      .select({ a: approvals, name: users.name, email: users.email })
      .from(approvals)
      .leftJoin(users, eq(users.id, approvals.actorId))
      .where(eq(approvals.recommendationId, r.id))
      .limit(1),
  ]);
  let stale = r.status === "STALE";
  if (r.status === "PENDING") {
    const built = await buildInput(db, actor, r.planId);
    if (built.hash !== r.inputHash) {
      stale = true;
      await db.update(recommendations).set({ status: "STALE" }).where(and(eq(recommendations.id, r.id), eq(recommendations.status, "PENDING")));
      await audit(db, actor, "recommendation.stale", "recommendation", r.id, { reason: "Inputs changed since the run." });
    }
  }
  const [proposedVersion, currentVersion] = await Promise.all([
    db.query.scheduleVersions.findFirst({ where: eq(scheduleVersions.id, r.proposedScheduleId) }),
    db.query.scheduleVersions.findFirst({ where: eq(scheduleVersions.id, r.currentScheduleId) }),
  ]);
  return {
    rec: { ...r, status: stale && r.status === "PENDING" ? ("STALE" as const) : r.status },
    plan: plan!,
    run: run!,
    proposed,
    current,
    proposedVersion: proposedVersion!,
    currentVersion: currentVersion!,
    approval: approval[0] ?? null,
  };
}

export const decisionSchema = z
  .object({
    recommendationId: z.string().min(1),
    decision: z.enum(["APPROVED", "REJECTED"]),
    reason: z.string().trim().max(500).default(""),
    expectedVersion: z.number().int().min(1),
  })
  .refine((d) => d.decision === "APPROVED" || d.reason.length >= 5, { message: "Give a reason for rejecting (at least 5 characters).", path: ["reason"] });

/**
 * Approve or reject a pending recommendation. Server-side checks: permission,
 * tenant, pending status, version match, and input freshness. The database's
 * unique index on approvals.recommendation_id blocks a second decision even under
 * concurrent requests. Approval changes the plan's active schedule record only;
 * nothing is ever sent to plant equipment.
 */
export async function decideRecommendation(db: DB, actor: Actor, raw: unknown) {
  requirePerm(actor, "recommendation.decide");
  const parsed = decisionSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw validation(issue?.message ?? "Invalid decision.", issue?.path?.[0] ? { [String(issue.path[0])]: issue.message } : undefined);
  }
  const input = parsed.data;
  const r = await db.query.recommendations.findFirst({
    where: and(eq(recommendations.id, input.recommendationId), eq(recommendations.factoryId, actor.factory.id)),
  });
  if (!r) throw notFound("Recommendation");
  if (r.status !== "PENDING") throw conflict(`This recommendation is already ${r.status.toLowerCase()}.`);
  if (r.version !== input.expectedVersion) throw conflict("A newer version of this recommendation exists. Reload before deciding.");
  const built = await buildInput(db, actor, r.planId);
  if (built.hash !== r.inputHash) {
    await db.update(recommendations).set({ status: "STALE" }).where(and(eq(recommendations.id, r.id), eq(recommendations.status, "PENDING")));
    await audit(db, actor, "recommendation.stale", "recommendation", r.id, { reason: "Inputs changed before the decision." });
    throw new AppError("STALE", "Plan, tariff or model inputs changed after this recommendation was made. Re-run the optimiser.");
  }
  const now = Date.now();
  try {
    await db.transaction(async (tx) => {
      const upd = await tx
        .update(recommendations)
        .set({ status: input.decision })
        .where(and(eq(recommendations.id, r.id), eq(recommendations.status, "PENDING")));
      if (upd.rowsAffected !== 1) throw conflict("Someone else decided this recommendation first.");
      await tx.insert(approvals).values({
        id: newId("apr"),
        factoryId: actor.factory.id,
        recommendationId: r.id,
        decision: input.decision,
        reason: input.reason,
        actorId: actor.userId,
        actorRole: actor.role,
        recommendationVersion: r.version,
        inputHash: r.inputHash,
        decidedAt: now,
      });
      if (input.decision === "APPROVED") {
        await tx
          .update(scheduleVersions)
          .set({ status: "SUPERSEDED" })
          .where(and(eq(scheduleVersions.planId, r.planId), eq(scheduleVersions.status, "ACTIVE")));
        await tx.update(scheduleVersions).set({ status: "ACTIVE" }).where(eq(scheduleVersions.id, r.proposedScheduleId));
      } else {
        // Rejection keeps the current schedule in place.
        await tx.update(scheduleVersions).set({ status: "REJECTED" }).where(eq(scheduleVersions.id, r.proposedScheduleId));
      }
      await audit(tx, actor, input.decision === "APPROVED" ? "recommendation.approve" : "recommendation.reject", "recommendation", r.id, {
        version: r.version,
        reason: input.reason || undefined,
        inputHash: r.inputHash,
        role: actor.role,
        note: "Advisory decision recorded. No command was sent to equipment.",
      });
    });
  } catch (e) {
    if (e instanceof AppError) throw e;
    const msg = String((e as Error)?.message ?? e);
    if (msg.includes("UNIQUE") || msg.includes("constraint")) throw conflict("A decision for this recommendation already exists.");
    throw e;
  }
}

/** The plan's schedule currently in force (approved recommendation, or current practice). */
export async function activeSchedule(db: DB, actor: Actor, planId: string) {
  requirePerm(actor, "view");
  const v = await db.query.scheduleVersions.findFirst({
    where: and(eq(scheduleVersions.planId, planId), eq(scheduleVersions.factoryId, actor.factory.id), eq(scheduleVersions.status, "ACTIVE")),
    orderBy: desc(scheduleVersions.version),
  });
  if (!v) return null;
  const items = await db.select().from(scheduleItems).where(eq(scheduleItems.scheduleVersionId, v.id)).orderBy(asc(scheduleItems.sequence));
  return { version: v, items };
}
