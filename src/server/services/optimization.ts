import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { lockKey } from "@/db/lock";
import { heats as heatsTable, optimizationRuns, recommendations, scheduleItems, scheduleVersions } from "@/db/schema";
import { expectedGoodPracticeKwh } from "@/domain/model";
import { optimise, type OptimizerInput, type OptimizerResult, type ScheduleEvaluation, type SiteLoad } from "@/domain/optimizer";
import { minuteRateTable, versionAt } from "@/domain/tariff";
import { replan } from "@/domain/replan";
import { localDate, localDayStart, localMinuteOfDay } from "@/domain/time";
import type { Actor } from "../context";
import { requirePerm } from "../context";
import { audit } from "../audit";
import { notFound, validation } from "../errors";
import { newId } from "../ids";
import { latestModel, loadTariffVersions, requireFurnace } from "./common";
import { getPlan, minuteOf, referenceDay } from "./plans";
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

export interface WhatIfParams {
  /** Multiplier on the rate in SOLAR windows (1 = as tariff). */
  solarRateFactor?: number;
  /** Multiplier on the rate in PEAK windows (1 = as tariff). */
  peakRateFactor?: number;
  holdingKw?: number;
  maxHoldMinutes?: number;
  deadlineMin?: number;
  availableFromMin?: number;
  availableToMin?: number;
  currentPracticeStartMin?: number;
  /** Let the solver reorder heats within an order. */
  allowReorder?: boolean;
  /** Override the site cap, kVA. null = no cap; undefined = the factory setting. */
  siteCapKva?: number | null;
}

const DAY_FROM = 6 * 60;
const DAY_TO = 22 * 60;

/** Shared-connection limits from the factory settings, or undefined when none are configured. */
export function siteLoad(f: Pick<Actor["factory"], "siteCapKva" | "powerFactor" | "baseLoadDayKw" | "baseLoadNightKw" | "demandRatePaisePerKvaMonth">, capOverrideKva?: number | null): SiteLoad | undefined {
  const capKva = capOverrideKva === undefined ? f.siteCapKva : capOverrideKva;
  if (capKva === null && f.baseLoadDayKw <= 0 && f.baseLoadNightKw <= 0 && f.demandRatePaisePerKvaMonth === null) return undefined;
  return {
    capKw: capKva === null ? null : capKva * f.powerFactor,
    baseLoadKw: Array.from({ length: 1440 }, (_, m) => (m >= DAY_FROM && m < DAY_TO ? f.baseLoadDayKw : f.baseLoadNightKw)),
    powerFactor: f.powerFactor,
  };
}

/** Assemble optimiser input from persisted records and fingerprint it for staleness checks. */
export async function buildInput(db: DB, actor: Actor, planId: string, ov: WhatIfParams = {}): Promise<BuiltInput> {
  const f = actor.factory;
  const detail = await getPlan(db, actor, planId);
  if (!detail) throw notFound("Plan");
  const furnace = await requireFurnace(db, f.id);
  const versions = await loadTariffVersions(db, f.id);
  const noon = localDayStart(detail.plan.planDate, f.timeZone) + 12 * 3600_000;
  const base = versionAt(versions, noon);
  const tariff =
    base && (ov.solarRateFactor !== undefined || ov.peakRateFactor !== undefined)
      ? {
          ...base,
          periods: base.periods.map((p) => ({
            ...p,
            ratePaise: p.ratePaise * (p.kind === "SOLAR" ? (ov.solarRateFactor ?? 1) : p.kind === "PEAK" ? (ov.peakRateFactor ?? 1) : 1),
          })),
        }
      : base;
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
      availableFromMin: ov.availableFromMin ?? furnace.availableFromMin,
      availableToMin: ov.availableToMin ?? furnace.availableToMin,
      maxHeatsPerDay: furnace.maxHeatsPerDay,
      downtime: detail.plan.downtime,
    },
    process: {
      nominalMeltMinutes: furnace.nominalMeltMinutes,
      coldExtraMinutes: f.coldExtraMinutes,
      coldGapMinutes: f.coldGapMinutes,
      turnaroundMinutes: f.turnaroundMinutes,
      holdingKw: ov.holdingKw ?? f.holdingKw,
      maxHoldMinutes: ov.maxHoldMinutes ?? f.maxHoldMinutes,
    },
    meltKwh: detail.heats.map((h) => ({
      warm: expectedGoodPracticeKwh(model, { chargeTonnes: h.chargeKg / 1000, coldStart: false }),
      cold: expectedGoodPracticeKwh(model, { chargeTonnes: h.chargeKg / 1000, coldStart: true }),
    })),
    pricePaise: Array.from(minuteRateTable(tariff)),
    deadlineMin: ov.deadlineMin ?? detail.plan.deadlineMin,
    currentPracticeStartMin: ov.currentPracticeStartMin ?? detail.plan.currentPracticeStartMin,
    allowReorder: ov.allowReorder === true,
    site: siteLoad(f, ov.siteCapKva),
  };
  const snapshot = {
    plan: { id: detail.plan.id, date: detail.plan.planDate, revision: detail.plan.revision },
    tariff: { id: tariff.id, version: tariff.version, name: tariff.name, normalRatePaise: tariff.normalRatePaise, periods: tariff.periods },
    model: { fitId, version: model.version, kind: model.kind, coefficients: model.coefficients, n: model.n },
    input: { ...input, pricePaise: undefined, allowReorder: undefined, site: input.site ? { capKw: input.site.capKw, powerFactor: input.site.powerFactor, baseLoadDayKw: f.baseLoadDayKw, baseLoadNightKw: f.baseLoadNightKw } : undefined },
  };
  const hash = createHash("sha256")
    .update(JSON.stringify({ ...snapshot, model: { ...snapshot.model, fitId: undefined }, plan: { id: detail.plan.id, date: detail.plan.planDate } }))
    .digest("hex")
    .slice(0, 32);
  // The reorder option is a run choice, not an input: it is recorded but does not change the fingerprint.
  return { input, hash, tariffVersionId: tariff.id, modelFitId: fitId, modelVersion: model.version, snapshot: { ...snapshot, options: { allowReorder: input.allowReorder === true } } };
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

function predicted(current: ScheduleEvaluation, rec: ScheduleEvaluation, demandRatePaisePerKvaMonth: number | null) {
  const c = current.totals;
  const r = rec.totals;
  const sec = (t: typeof c) => (t.tonnesPoured > 0 ? t.kwh / t.tonnesPoured : null);
  const cpt = (t: typeof c) => (t.tonnesPoured > 0 ? t.costPaise / t.tonnesPoured : null);
  return {
    label: "MODELLED",
    current: { kwh: c.kwh, costPaise: c.costPaise, holdMinutes: c.holdMinutes, tonnes: c.tonnesPoured, sec: sec(c), costPerTonnePaise: cpt(c), firstStartMin: c.firstStartMin, lastTapMin: c.lastTapMin },
    recommended: { kwh: r.kwh, costPaise: r.costPaise, holdMinutes: r.holdMinutes, tonnes: r.tonnesPoured, sec: sec(r), costPerTonnePaise: cpt(r), firstStartMin: r.firstStartMin, lastTapMin: r.lastTapMin },
    peak: {
      currentKva: c.peak15Kva,
      recommendedKva: r.peak15Kva,
      // Only if this day sets the month's billing peak; shown as a bound, not a forecast.
      monthlyChargeDeltaPaise: demandRatePaisePerKvaMonth !== null && c.peak15Kva !== null && r.peak15Kva !== null ? (r.peak15Kva - c.peak15Kva) * demandRatePaisePerKvaMonth : null,
    },
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

export async function runOptimization(db: DB, actor: Actor, planId: string, opts: { allowReorder?: boolean } = {}): Promise<RunOutcome> {
  requirePerm(actor, "optimizer.run");
  const f = actor.factory;
  const built = await buildInput(db, actor, planId, { allowReorder: opts.allowReorder === true });
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
      // One writer per factory at a time for this check-then-write.
      await lockKey(tx, actor.factory.id);
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
    // One writer per factory at a time for this check-then-write.
    await lockKey(tx, actor.factory.id);
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
    const p = predicted(result.current, result.recommended, f.demandRatePaisePerKvaMonth);
    // At least ₹1 or 1 kWh better, or the schedule fixes a hard limit that current practice breaks (for example the site cap).
    const fixesViolation = !result.current.feasible && result.recommended.feasible;
    const meaningful = fixesViolation || p.delta.costPaise < -100 || p.delta.kwh < -1;
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
    const summary = `${fixesViolation ? "Current practice breaks a hard limit; this schedule respects every limit. " : ""}Start first heat ${hhmm(p.current.firstStartMin)} → ${hhmm(p.recommended.firstStartMin)}; holding ${p.current.holdMinutes} → ${p.recommended.holdMinutes} min; last tap ${hhmm(p.recommended.lastTapMin)}.${result.reordered ? ` Heat order changed within orders: ${result.recommended.items.map((i) => i.label).join(", ")}.` : ""}`;
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

export interface WhatIfResult {
  label: "MODELLED";
  status: "OPTIMAL" | "INFEASIBLE";
  runtimeMs: number;
  blocking: string[];
  current: { costPaise: number; kwh: number; holdMinutes: number; firstStartMin: number | null; lastTapMin: number | null; peak15Kva: number | null };
  recommended: { costPaise: number; kwh: number; holdMinutes: number; firstStartMin: number | null; lastTapMin: number | null; peak15Kva: number | null } | null;
  reordered: boolean;
  sequence: string[];
  /** Cost saved versus current practice, paise per tonne poured. */
  savingPaisePerTonne: number | null;
}

const clampN = (v: number | undefined, lo: number, hi: number) => (v === undefined || !Number.isFinite(v) ? undefined : Math.min(hi, Math.max(lo, v)));

/**
 * Re-run the optimiser with overridden inputs without saving anything. A planning
 * aid only: it creates no run, recommendation or approval, and its figures are MODELLED.
 */
export async function whatIf(db: DB, actor: Actor, planId: string, p: WhatIfParams): Promise<WhatIfResult> {
  requirePerm(actor, "view");
  const ov: WhatIfParams = {
    solarRateFactor: clampN(p.solarRateFactor, 0.2, 3),
    peakRateFactor: clampN(p.peakRateFactor, 0.2, 3),
    holdingKw: clampN(p.holdingKw, 0, 5000),
    maxHoldMinutes: clampN(p.maxHoldMinutes, 0, 720),
    deadlineMin: clampN(p.deadlineMin, 0, 1440),
    availableFromMin: clampN(p.availableFromMin, 0, 1440),
    availableToMin: clampN(p.availableToMin, 0, 1440),
    currentPracticeStartMin: clampN(p.currentPracticeStartMin, 0, 1440),
    allowReorder: p.allowReorder === true,
    siteCapKva: p.siteCapKva === undefined ? undefined : p.siteCapKva === null || !Number.isFinite(p.siteCapKva) || p.siteCapKva <= 0 ? null : Math.min(1_000_000, p.siteCapKva),
  };
  const built = await buildInput(db, actor, planId, ov);
  const r = optimise(built.input);
  const pick = (e: ScheduleEvaluation) => ({ costPaise: e.totals.costPaise, kwh: e.totals.kwh, holdMinutes: e.totals.holdMinutes, firstStartMin: e.totals.firstStartMin, lastTapMin: e.totals.lastTapMin, peak15Kva: e.totals.peak15Kva });
  const rec = r.recommended;
  return {
    label: "MODELLED",
    status: r.status,
    runtimeMs: r.runtimeMs,
    blocking: r.blocking.map((b) => `${b.constraint}: ${b.detail}`),
    current: pick(r.current),
    recommended: rec ? pick(rec) : null,
    reordered: r.reordered,
    sequence: rec ? rec.items.map((i) => i.label) : [],
    savingPaisePerTonne: rec && rec.totals.tonnesPoured > 0 ? (r.current.totals.costPaise - rec.totals.costPaise) / rec.totals.tonnesPoured : null,
  };
}

export interface ReplanParams {
  /** Local minute to re-plan from. Default: now if the plan is for today, else the furnace's start. */
  nowMin?: number;
  /** Plan heat ids already poured. Default: heats recorded today with a tap time. */
  done?: string[];
  /** The furnace is busy until this local minute (a heat melting, a repair). */
  busyUntilMin?: number | null;
}

export interface ReplanView {
  label: "MODELLED";
  nowMin: number;
  freeFromMin: number;
  status: "OPTIMAL" | "INFEASIBLE" | "DONE";
  heats: { id: string; label: string; done: boolean; recordedTapMin: number | null }[];
  items: { label: string; startMin: number; tapMin: number; holdMin: number; cold: boolean; costPaise: number; moved: boolean }[];
  current: { costPaise: number; kwh: number; holdMinutes: number; lastTapMin: number | null } | null;
  recommended: { costPaise: number; kwh: number; holdMinutes: number; lastTapMin: number | null } | null;
  remainingTonnes: { code: string; tonnes: number }[];
  blocking: string[];
  notes: string[];
}

/**
 * Re-plan the rest of the shift from now. Heats already poured stay as they ran; only
 * the remaining heats are re-optimised. Nothing is saved: like the what-if sandbox this
 * creates no run, recommendation or approval, and every figure is MODELLED.
 */
export async function replanShift(db: DB, actor: Actor, planId: string, p: ReplanParams = {}): Promise<ReplanView> {
  requirePerm(actor, "view");
  const f = actor.factory;
  const detail = await getPlan(db, actor, planId);
  if (!detail) throw notFound("Plan");
  const built = await buildInput(db, actor, planId);
  const date = detail.plan.planDate;
  const recorded = await db
    .select({ heatNo: heatsTable.heatNo, tapAt: heatsTable.tapAt })
    .from(heatsTable)
    .where(and(eq(heatsTable.factoryId, f.id), eq(heatsTable.dayDate, date)));
  const tapByNo = new Map<string, number>();
  for (const r of recorded) if (r.tapAt !== null) tapByNo.set(r.heatNo.trim().toLowerCase(), minuteOf(date, r.tapAt, f.timeZone));
  const recordedTap = (label: string) => tapByNo.get(label.trim().toLowerCase()) ?? null;

  const now = Date.now();
  const nowMin =
    clampN(p.nowMin, 0, 1440) ?? (localDate(now, f.timeZone) === date ? localMinuteOfDay(now, f.timeZone) : built.input.furnace.availableFromMin);
  const ids = new Set(built.input.heats.map((h) => h.key));
  const doneIds = p.done ? p.done.filter((id) => ids.has(id)) : built.input.heats.filter((h) => recordedTap(h.label) !== null).map((h) => h.key);
  const notes: string[] = [];
  const done = doneIds.map((id) => {
    const h = built.input.heats.find((x) => x.key === id)!;
    const tap = recordedTap(h.label);
    return { key: id, tapMin: tap ?? nowMin };
  });
  if (done.some((d) => recordedTap(built.input.heats.find((h) => h.key === d.key)!.label) === null))
    notes.push("Heats marked poured without a recorded tap time are taken as tapped now.");
  const busy = p.busyUntilMin === null || p.busyUntilMin === undefined ? null : (clampN(p.busyUntilMin, 0, 1440) ?? null);
  const r = replan(built.input, { nowMin, done, busyUntilMin: busy });

  const dayAhead = await latestRun(db, actor, planId);
  const plannedStart = new Map<string, number>();
  const recItems = (dayAhead?.result as { recommended?: { items?: { label: string; startMin: number }[] } } | null)?.recommended?.items ?? [];
  for (const it of recItems) plannedStart.set(it.label, it.startMin);

  const res = r.result;
  const rec = res?.recommended ?? null;
  const pick = (e: ScheduleEvaluation) => ({ costPaise: e.totals.costPaise, kwh: e.totals.kwh, holdMinutes: e.totals.holdMinutes, lastTapMin: e.totals.lastTapMin });
  return {
    label: "MODELLED",
    nowMin,
    freeFromMin: r.freeFromMin,
    status: res === null ? "DONE" : res.status,
    heats: built.input.heats.map((h) => ({ id: h.key, label: h.label, done: doneIds.includes(h.key), recordedTapMin: recordedTap(h.label) })),
    items: rec
      ? rec.items.map((it) => ({
          label: it.label,
          startMin: it.startMin,
          tapMin: it.tapMin,
          holdMin: it.holdMin,
          cold: it.cold,
          costPaise: it.costPaise,
          moved: plannedStart.has(it.label) && plannedStart.get(it.label) !== it.startMin,
        }))
      : [],
    current: res ? pick(res.current) : null,
    recommended: rec ? pick(rec) : null,
    remainingTonnes: r.remainingTonnes.filter((o) => o.tonnes > 0).map((o) => ({ code: o.code, tonnes: o.tonnes })),
    blocking: res ? res.blocking.map((b) => `${b.constraint}: ${b.detail}`) : [],
    notes: [...r.notes, ...notes],
  };
}
