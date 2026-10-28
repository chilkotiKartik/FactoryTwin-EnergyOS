import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { optimizationRuns, recommendations, scheduleItems, scheduleVersions } from "@/db/schema";
import { expectedGoodPracticeKwh } from "@/domain/model";
import { optimise, type OptimizerInput, type OptimizerResult, type ScheduleEvaluation } from "@/domain/optimizer";
import { minuteRateTable, versionAt } from "@/domain/tariff";
import { localDayStart } from "@/domain/time";
import type { Actor } from "../context";
import { requirePerm } from "../context";
import { audit } from "../audit";
import { notFound, validation } from "../errors";
import { newId } from "../ids";
import { latestModel, loadTariffVersions, requireFurnace } from "./common";
import { getPlan, referenceDay } from "./plans";
import { rangeSummary } from "./analytics";
import { raiseAlert } from "./alerts";

export interface BuiltInput {
  input: OptimizerInput;
  hash: string;
  tariffVersionId: string;
  modelFitId: string | null;
  modelVersion: string;
  snapshot: Record<string, unknown>;
}

/** Assemble optimiser input from persisted records and fingerprint it for staleness checks. */
export async function buildInput(db: DB, actor: Actor, planId: string): Promise<BuiltInput> {
  const f = actor.factory;
  const detail = await getPlan(db, actor, planId);
  if (!detail) throw notFound("Plan");
  const furnace = await requireFurnace(db, f.id);
  const versions = await loadTariffVersions(db, f.id);
  const noon = localDayStart(detail.plan.planDate, f.timeZone) + 12 * 3600_000;
  const tariff = versionAt(versions, noon);
  if (!tariff) throw validation("No tariff version is in force for the plan date. Add one under Tariffs.");
  const { model, fitId } = await latestModel(db, f.id, furnace, f);
  const input: OptimizerInput = {
    gridMinutes: f.gridMinutes,
    heats: detail.heats.map((h) => ({
      key: h.id,
      label: h.heatNo,
      orderId: h.orderId,
      chargeKg: h.chargeKg,
      pouredKg: h.pouredKg,
      mouldSet: h.mouldSet,
      mouldReadyMin: h.mouldReadyMin,
    })),
    orders: detail.orders.map((o) => ({ id: o.id, code: o.code, requiredTonnes: o.requiredTonnes, dueMin: o.dueMin })),
    furnace: {
      capacityKg: furnace.capacityKg,
      ratedKw: furnace.ratedKw,
      availableFromMin: furnace.availableFromMin,
      availableToMin: furnace.availableToMin,
      maxHeatsPerDay: furnace.maxHeatsPerDay,
      downtime: detail.plan.downtime,
    },
    process: {
      nominalMeltMinutes: furnace.nominalMeltMinutes,
      coldExtraMinutes: f.coldExtraMinutes,
      coldGapMinutes: f.coldGapMinutes,
      turnaroundMinutes: f.turnaroundMinutes,
      holdingKw: f.holdingKw,
      maxHoldMinutes: f.maxHoldMinutes,
    },
    meltKwh: detail.heats.map((h) => ({
      warm: expectedGoodPracticeKwh(model, { chargeTonnes: h.chargeKg / 1000, coldStart: false }),
      cold: expectedGoodPracticeKwh(model, { chargeTonnes: h.chargeKg / 1000, coldStart: true }),
    })),
    pricePaise: Array.from(minuteRateTable(tariff)),
    deadlineMin: detail.plan.deadlineMin,
    currentPracticeStartMin: detail.plan.currentPracticeStartMin,
  };
  const snapshot = {
    plan: { id: detail.plan.id, date: detail.plan.planDate, revision: detail.plan.revision },
    tariff: { id: tariff.id, version: tariff.version, name: tariff.name, normalRatePaise: tariff.normalRatePaise, periods: tariff.periods },
    model: { fitId, version: model.version, kind: model.kind, coefficients: model.coefficients, n: model.n },
    input: { ...input, pricePaise: undefined },
  };
  const hash = createHash("sha256")
    .update(JSON.stringify({ ...snapshot, model: { ...snapshot.model, fitId: undefined }, plan: { id: detail.plan.id, date: detail.plan.planDate } }))
    .digest("hex")
    .slice(0, 32);
  return { input, hash, tariffVersionId: tariff.id, modelFitId: fitId, modelVersion: model.version, snapshot };
}

export interface RunOutcome {
  runId: string;
  status: "OPTIMAL" | "INFEASIBLE" | "PAUSED_DATA_QUALITY";
  recommendationId: string | null;
  message: string;
}

export const DATA_QUALITY_PAUSE = "PAUSED_DATA_QUALITY" as const;

async function insertSchedule(
  tx: Pick<DB, "insert">,
  factoryId: string,
  planId: string,
  runId: string,
  kind: "CURRENT_PRACTICE" | "RECOMMENDED",
  status: "ACTIVE" | "PROPOSED" | "SUPERSEDED",
  version: number,
  ev: ScheduleEvaluation,
) {
  const id = newId("sch");
  await tx.insert(scheduleVersions).values({ id, factoryId, planId, optimizationRunId: runId, kind, status, version, totals: ev.totals as unknown as Record<string, unknown> });
  for (const [i, it] of ev.items.entries()) {
    await tx.insert(scheduleItems).values({
      id: newId("sci"),
      scheduleVersionId: id,
      sequence: i + 1,
      heatNo: it.label,
      orderId: it.orderId,
      mouldSet: it.mouldSet,
      mouldReadyMin: it.mouldReadyMin,
      startMin: it.startMin,
      meltEndMin: it.meltEndMin,
      tapMin: it.tapMin,
      holdMin: it.holdMin,
      cold: it.cold,
      meltKwh: it.meltKwh,
      holdKwh: it.holdKwh,
      costPaise: it.costPaise,
      chargeKg: it.chargeKg,
      pouredKg: it.pouredKg,
    });
  }
  return id;
}

function predicted(current: ScheduleEvaluation, rec: ScheduleEvaluation) {
  const c = current.totals;
  const r = rec.totals;
  const sec = (t: typeof c) => (t.tonnesPoured > 0 ? t.kwh / t.tonnesPoured : null);
  const cpt = (t: typeof c) => (t.tonnesPoured > 0 ? t.costPaise / t.tonnesPoured : null);
  return {
    label: "MODELLED",
    current: { kwh: c.kwh, costPaise: c.costPaise, holdMinutes: c.holdMinutes, tonnes: c.tonnesPoured, sec: sec(c), costPerTonnePaise: cpt(c), firstStartMin: c.firstStartMin, lastTapMin: c.lastTapMin },
    recommended: { kwh: r.kwh, costPaise: r.costPaise, holdMinutes: r.holdMinutes, tonnes: r.tonnesPoured, sec: sec(r), costPerTonnePaise: cpt(r), firstStartMin: r.firstStartMin, lastTapMin: r.lastTapMin },
    delta: {
      kwh: r.kwh - c.kwh,
      kwhPct: c.kwh > 0 ? (100 * (r.kwh - c.kwh)) / c.kwh : null,
      costPaise: r.costPaise - c.costPaise,
      costPct: c.costPaise > 0 ? (100 * (r.costPaise - c.costPaise)) / c.costPaise : null,
      holdMinutes: r.holdMinutes - c.holdMinutes,
      tonnes: r.tonnesPoured - c.tonnesPoured,
    },
  };
}

const hhmm = (m: number | null) => (m === null ? "—" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);

export async function runOptimization(db: DB, actor: Actor, planId: string): Promise<RunOutcome> {
  requirePerm(actor, "optimizer.run");
  const f = actor.factory;
  const built = await buildInput(db, actor, planId);
  const detail = (await getPlan(db, actor, planId))!;

  // Data-quality gate: advice pauses when the reference day's meter data is incomplete.
  const refDay = await referenceDay(db, actor, detail.plan.planDate);
  let dq: { day: string | null; completeness: number | null; gaps: number } = { day: refDay, completeness: null, gaps: 0 };
  if (refDay) {
    const s = await rangeSummary(db, actor, refDay, refDay);
    dq = { day: refDay, completeness: s.completenessOperating, gaps: s.gaps.length };
  }
  const runId = newId("run");
  if (dq.completeness !== null && dq.completeness < f.minCompleteness) {
    const message = `Advice paused: meter data for ${refDay} is ${(dq.completeness * 100).toFixed(1)}% complete during operation (${dq.gaps} gap${dq.gaps === 1 ? "" : "s"}); the minimum is ${(f.minCompleteness * 100).toFixed(0)}%. Fix or explain the gap, then re-run.`;
    await db.transaction(async (tx) => {
      await tx.insert(optimizationRuns).values({
        id: runId,
        factoryId: f.id,
        planId,
        status: DATA_QUALITY_PAUSE,
        solver: "-",
        solverVersion: "-",
        modelVersion: built.modelVersion,
        modelFitId: built.modelFitId,
        tariffVersionId: built.tariffVersionId,
        inputHash: built.hash,
        inputSnapshot: built.snapshot,
        result: { message, dataQuality: dq },
        runtimeMs: 0,
        createdBy: actor.userId,
      });
      await audit(tx, actor, "optimizer.paused", "optimization_run", runId, { planId, dataQuality: dq });
    });
    await raiseAlert(db, f, { kind: "ADVICE_PAUSED", key: `paused:${planId}:${refDay}:${dq.completeness}`, title: `Advice paused for ${detail.plan.planDate}`, body: message, href: "/meters" });
    return { runId, status: DATA_QUALITY_PAUSE, recommendationId: null, message };
  }

  const result: OptimizerResult = optimise(built.input);
  let recommendationId: string | null = null;
  let message: string;
  await db.transaction(async (tx) => {
    await tx.insert(optimizationRuns).values({
      id: runId,
      factoryId: f.id,
      planId,
      status: result.status,
      solver: result.solver,
      solverVersion: result.solverVersion,
      modelVersion: built.modelVersion,
      modelFitId: built.modelFitId,
      tariffVersionId: built.tariffVersionId,
      inputHash: built.hash,
      inputSnapshot: built.snapshot,
      result: { ...result, dataQuality: dq } as unknown as Record<string, unknown>,
      runtimeMs: result.runtimeMs,
      createdBy: actor.userId,
    });
    if (result.status !== "OPTIMAL" || !result.recommended) {
      message = `No feasible schedule: ${result.blocking[0]?.detail ?? "constraints cannot all be met."}`;
      await audit(tx, actor, "optimizer.infeasible", "optimization_run", runId, { planId, blocking: result.blocking });
      return;
    }
    // Comparison snapshot of current practice and the proposed schedule.
    const activeApproved = await tx.query.scheduleVersions.findFirst({
      where: and(eq(scheduleVersions.planId, planId), eq(scheduleVersions.status, "ACTIVE"), eq(scheduleVersions.kind, "RECOMMENDED")),
    });
    const nextVer = await tx
      .select({ v: sql<number>`coalesce(max(${scheduleVersions.version}), 0)` })
      .from(scheduleVersions)
      .where(eq(scheduleVersions.planId, planId));
    let v = Number(nextVer[0]?.v ?? 0);
    if (!activeApproved) {
      await tx
        .update(scheduleVersions)
        .set({ status: "SUPERSEDED" })
        .where(and(eq(scheduleVersions.planId, planId), eq(scheduleVersions.status, "ACTIVE"), eq(scheduleVersions.kind, "CURRENT_PRACTICE")));
    }
    const currentId = await insertSchedule(tx, f.id, planId, runId, "CURRENT_PRACTICE", activeApproved ? "SUPERSEDED" : "ACTIVE", ++v, result.current);
    const p = predicted(result.current, result.recommended);
    const meaningful = p.delta.costPaise < -100 || p.delta.kwh < -1; // at least ₹1 or 1 kWh better
    if (!meaningful) {
      message = "The optimum matches current practice within ₹1 and 1 kWh. No change is recommended.";
      await audit(tx, actor, "optimizer.no_change", "optimization_run", runId, { planId });
      return;
    }
    const proposedId = await insertSchedule(tx, f.id, planId, runId, "RECOMMENDED", "PROPOSED", ++v, result.recommended);
    await tx
      .update(recommendations)
      .set({ status: "SUPERSEDED" })
      .where(and(eq(recommendations.planId, planId), eq(recommendations.status, "PENDING")));
    const verRow = await tx
      .select({ v: sql<number>`coalesce(max(${recommendations.version}), 0)` })
      .from(recommendations)
      .where(eq(recommendations.planId, planId));
    const recVersion = Number(verRow[0]?.v ?? 0) + 1;
    recommendationId = newId("rec");
    const summary = `Start first heat ${hhmm(p.current.firstStartMin)} → ${hhmm(p.recommended.firstStartMin)}; holding ${p.current.holdMinutes} → ${p.recommended.holdMinutes} min; last tap ${hhmm(p.recommended.lastTapMin)}.`;
    await tx.insert(recommendations).values({
      id: recommendationId,
      factoryId: f.id,
      planId,
      optimizationRunId: runId,
      proposedScheduleId: proposedId,
      currentScheduleId: currentId,
      version: recVersion,
      status: "PENDING",
      inputHash: built.hash,
      inputTimestamp: detail.plan.updatedAt,
      predicted: p,
      summary,
      createdBy: actor.userId,
    });
    message = `Recommendation v${recVersion} ready for review.`;
    await audit(tx, actor, "optimizer.run", "optimization_run", runId, {
      planId,
      status: result.status,
      runtimeMs: Math.round(result.runtimeMs),
      recommendationId,
      predictedDelta: p.delta,
    });
  });
  if (recommendationId) {
    await raiseAlert(db, f, { kind: "APPROVAL_PENDING", key: `rec:${recommendationId}`, title: `Schedule for ${detail.plan.planDate} awaits a decision`, body: message!, href: `/recommendations/${recommendationId}` });
  }
  return { runId, status: result.status, recommendationId, message: message! };
}

export async function getRun(db: DB, actor: Actor, runId: string) {
  requirePerm(actor, "view");
  const run = await db.query.optimizationRuns.findFirst({ where: and(eq(optimizationRuns.id, runId), eq(optimizationRuns.factoryId, actor.factory.id)) });
  return run ?? null;
}

export async function latestRun(db: DB, actor: Actor, planId: string) {
  requirePerm(actor, "view");
  return (
    (await db.query.optimizationRuns.findFirst({
      where: and(eq(optimizationRuns.planId, planId), eq(optimizationRuns.factoryId, actor.factory.id)),
      orderBy: desc(optimizationRuns.createdAt),
    })) ?? null
  );
}

export async function listRuns(db: DB, actor: Actor, planId: string) {
  requirePerm(actor, "view");
  return db
    .select({
      id: optimizationRuns.id,
      status: optimizationRuns.status,
      runtimeMs: optimizationRuns.runtimeMs,
      createdAt: optimizationRuns.createdAt,
      inputHash: optimizationRuns.inputHash,
      solver: optimizationRuns.solver,
      solverVersion: optimizationRuns.solverVersion,
    })
    .from(optimizationRuns)
    .where(and(eq(optimizationRuns.planId, planId), eq(optimizationRuns.factoryId, actor.factory.id)))
    .orderBy(desc(optimizationRuns.createdAt))
    .limit(20);
}

/** Is a run's input still the same as the current persisted input? */
export async function isStale(db: DB, actor: Actor, planId: string, inputHash: string): Promise<boolean> {
  const built = await buildInput(db, actor, planId);
  return built.hash !== inputHash;
}
