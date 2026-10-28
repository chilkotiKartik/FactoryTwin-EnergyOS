import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as s from "@/db/schema";
import {
  AS_RUN_DATE,
  BASE_SEED,
  PLAN_DATE,
  SCENARIOS,
  SCENARIO_KEYS,
  dayPlan,
  historyPlans,
  type ScenarioKey,
} from "@/domain/scenarios";
import { DEFAULT_SIM_PARAMS, simulateDay, type FurnaceSimParams, type SimDay } from "@/domain/simulator";
import { deckDefaultTariff } from "@/domain/tariff";
import { localDayStart, localToUtc } from "@/domain/time";
import type { Actor } from "../context";
import { requirePerm } from "../context";
import { audit } from "../audit";
import { forbidden, validation } from "../errors";
import { newId } from "../ids";
import { hashPassword } from "../auth/password";
import { analyseFactory } from "./analysis";

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

export function simParamsFor(factory: { holdingKw: number; turnaroundMinutes: number; coldGapMinutes: number; coldExtraMinutes: number }, furnace: { capacityKg: number; ratedKw: number; nominalMeltMinutes: number }): FurnaceSimParams {
  return {
    ...DEFAULT_SIM_PARAMS,
    capacityKg: furnace.capacityKg,
    ratedKw: furnace.ratedKw,
    nominalMeltMinutes: furnace.nominalMeltMinutes,
    holdingKw: factory.holdingKw,
    turnaroundMinutes: factory.turnaroundMinutes,
    coldGapMinutes: factory.coldGapMinutes,
    coldExtraMinutes: factory.coldExtraMinutes,
  };
}

export async function insertReadings(tx: Pick<DB, "insert">, rows: (typeof s.meterReadings.$inferInsert)[]) {
  for (let i = 0; i < rows.length; i += 500) {
    await tx.insert(s.meterReadings).values(rows.slice(i, i + 500)).onConflictDoNothing();
  }
}

/** Write a simulated day (heats, recorded mould events, readings) for a factory. */
export async function writeSimDay(
  tx: Tx,
  ctx: { factoryId: string; furnaceId: string; meterId: string; timeZone: string },
  day: SimDay,
  grades: Map<string, string>,
  opts: { executionId?: string; defects?: (typeof SCENARIOS)[ScenarioKey]["meterDefects"]; noteFor?: (heatNo: string) => string } = {},
) {
  const dayStart = localDayStart(day.date, ctx.timeZone);
  const at = (m: number) => dayStart + m * 60000;
  const now = Date.now();
  for (const h of day.heats) {
    await tx.insert(s.heats).values({
      id: newId("het"),
      factoryId: ctx.factoryId,
      furnaceId: ctx.furnaceId,
      dayDate: day.date,
      heatNo: h.heatNo,
      grade: (h.orderCode && grades.get(h.orderCode)) || "",
      orderCode: h.orderCode,
      chargeKg: h.chargeKg,
      pouredKg: h.pouredKg,
      startAt: at(h.startMin),
      meltEndAt: at(h.meltEndMin),
      tapAt: at(h.tapMin),
      mouldSet: h.mouldSet,
      mouldReadyAt: at(h.mouldReadyMin),
      coldStart: h.cold,
      operatorNotes: opts.noteFor?.(h.heatNo) ?? "",
      provenance: "SIMULATED",
      executionId: opts.executionId ?? null,
      createdBy: null,
      updatedAt: now,
    });
    await tx
      .insert(s.mouldEvents)
      .values({
        id: newId("mld"),
        factoryId: ctx.factoryId,
        dayDate: day.date,
        kind: "RECORDED",
        mouldSet: h.mouldSet,
        readyAt: at(h.mouldReadyMin),
        provenance: "SIMULATED",
      })
      .onConflictDoNothing();
  }
  const defects = opts.defects;
  const rows: (typeof s.meterReadings.$inferInsert)[] = [];
  for (const r of day.readings) {
    if (defects && r.minute >= defects.gap.fromMin && r.minute < defects.gap.toMin) continue;
    let kw = r.powerKw;
    let kwh = r.energyKwh;
    if (defects && r.minute >= defects.unlinked.fromMin && r.minute < defects.unlinked.toMin) {
      kw = defects.unlinked.kw;
      kwh = Math.round((kw / 60) * 10000) / 10000;
    }
    rows.push({ factoryId: ctx.factoryId, meterId: ctx.meterId, ts: at(r.minute), powerKw: kw, energyKwh: kwh, quality: "OK", provenance: "SIMULATED" });
  }
  await insertReadings(tx, rows);
}

/** Delete one simulation factory's scenario data. Users, memberships, assets and audit history are kept. */
async function clearFactoryData(tx: Tx, factoryId: string) {
  const plans = await tx.select({ id: s.productionPlans.id }).from(s.productionPlans).where(eq(s.productionPlans.factoryId, factoryId));
  const planIds = plans.map((p) => p.id);
  const recs = planIds.length ? await tx.select({ id: s.recommendations.id }).from(s.recommendations).where(inArray(s.recommendations.planId, planIds)) : [];
  if (recs.length) await tx.delete(s.approvals).where(inArray(s.approvals.recommendationId, recs.map((r) => r.id)));
  await tx.delete(s.recommendations).where(eq(s.recommendations.factoryId, factoryId));
  await tx.delete(s.executionRecords).where(eq(s.executionRecords.factoryId, factoryId));
  const sv = await tx.select({ id: s.scheduleVersions.id }).from(s.scheduleVersions).where(eq(s.scheduleVersions.factoryId, factoryId));
  if (sv.length) await tx.delete(s.scheduleItems).where(inArray(s.scheduleItems.scheduleVersionId, sv.map((x) => x.id)));
  await tx.delete(s.scheduleVersions).where(eq(s.scheduleVersions.factoryId, factoryId));
  await tx.delete(s.optimizationRuns).where(eq(s.optimizationRuns.factoryId, factoryId));
  await tx.delete(s.plannedHeats).where(eq(s.plannedHeats.factoryId, factoryId));
  await tx.delete(s.productionOrders).where(eq(s.productionOrders.factoryId, factoryId));
  await tx.delete(s.productionPlans).where(eq(s.productionPlans.factoryId, factoryId));
  await tx.delete(s.anomalies).where(eq(s.anomalies.factoryId, factoryId));
  await tx.delete(s.heats).where(eq(s.heats.factoryId, factoryId));
  await tx.delete(s.mouldEvents).where(eq(s.mouldEvents.factoryId, factoryId));
  await tx.delete(s.meterReadings).where(eq(s.meterReadings.factoryId, factoryId));
  await tx.delete(s.importBatches).where(eq(s.importBatches.factoryId, factoryId));
  await tx.delete(s.modelFits).where(eq(s.modelFits.factoryId, factoryId));
  await tx.delete(s.alerts).where(eq(s.alerts.factoryId, factoryId));
  await tx.delete(s.verificationReports).where(eq(s.verificationReports.factoryId, factoryId));
  await tx.delete(s.energyBaselines).where(eq(s.energyBaselines.factoryId, factoryId));
  const tv = await tx.select({ id: s.tariffVersions.id }).from(s.tariffVersions).where(eq(s.tariffVersions.factoryId, factoryId));
  if (tv.length) await tx.delete(s.tariffPeriods).where(inArray(s.tariffPeriods.tariffVersionId, tv.map((x) => x.id)));
  await tx.delete(s.tariffVersions).where(eq(s.tariffVersions.factoryId, factoryId));
}

/**
 * Reset the simulation factory to a scenario. Deterministic: the same scenario
 * always produces the same records (apart from generated ids and timestamps).
 */
export async function resetScenario(db: DB, actor: Actor, key: string) {
  requirePerm(actor, "demo.reset");
  if (!actor.factory.isSimulation) throw forbidden("Demo reset is only available in a simulation factory. Real factory data is never reset.");
  if (!(SCENARIO_KEYS as readonly string[]).includes(key)) throw validation("Unknown scenario.");
  const sc = SCENARIOS[key as ScenarioKey];
  const f = actor.factory;
  const furnace = await db.query.furnaces.findFirst({ where: eq(s.furnaces.factoryId, f.id) });
  const meter = await db.query.meters.findFirst({ where: eq(s.meters.factoryId, f.id) });
  if (!furnace || !meter) throw validation("The simulation factory needs a furnace and a meter.");
  const params = simParamsFor(f, furnace);
  const ctx = { factoryId: f.id, furnaceId: furnace.id, meterId: meter.id, timeZone: f.timeZone };
  const grades = new Map(sc.orders.map((o) => [o.code, o.grade]));

  await db.transaction(async (tx) => {
    await clearFactoryData(tx, f.id);
    // Tariff v1 (assumption from the deck), effective from well before the history.
    const tvId = newId("tar");
    const t = deckDefaultTariff(localToUtc("2026-01-01", 0, f.timeZone), f.timeZone);
    await tx.insert(s.tariffVersions).values({
      id: tvId,
      factoryId: f.id,
      version: 1,
      name: t.name,
      effectiveFrom: t.effectiveFrom,
      timeZone: t.timeZone,
      normalRatePaise: t.normalRatePaise,
      evidence: "ASSUMPTION",
      sourceNote:
        "Rates are deck assumptions (₹8.00 normal). Multipliers follow the Electricity (Rights of Consumers) Amendment Rules 2023: C&I peak ≥ 1.20× normal, solar hours ≥ 20% below normal. Replace with your DISCOM's tariff order.",
      createdBy: actor.userId,
    });
    for (const p of t.periods) {
      await tx.insert(s.tariffPeriods).values({ id: newId("tpr"), tariffVersionId: tvId, ...p });
    }
    // 30 days of history under current practice.
    for (const h of historyPlans()) {
      const day = simulateDay(h.date, h.plan, { kind: "CURRENT_PRACTICE", startMin: 360 }, params, h.seed);
      await writeSimDay(tx, ctx, day, new Map([["PO-2611", "FG260 grey iron"], ["PO-2614", "SG500/7 ductile"]]));
    }
    // The as-run day for this scenario.
    const asRun = simulateDay(AS_RUN_DATE, dayPlan(sc.asRunMould, sc.orders), { kind: "CURRENT_PRACTICE", startMin: 360 }, params, BASE_SEED + 1);
    await writeSimDay(tx, ctx, asRun, grades, {
      defects: sc.meterDefects,
      noteFor: (no) =>
        no === "H07" && key !== "baseline-shift" && key !== "tariff-optimization" ? "Metal held in furnace; moulding line behind on set 7." : "",
    });
    // Next-day plan with the scenario's orders, mould plan and limits.
    const planId = newId("pln");
    await tx.insert(s.productionPlans).values({
      id: planId,
      factoryId: f.id,
      furnaceId: furnace.id,
      planDate: PLAN_DATE,
      deadlineMin: sc.planDeadlineMin,
      currentPracticeStartMin: 360,
      downtime: sc.planDowntime,
      notes: `Scenario: ${sc.name}. Moulding plan assumed to repeat the as-run day (ASSUMPTION).`,
      provenance: "SIMULATED",
      updatedAt: Date.now(),
    });
    const orderIds = new Map<string, string>();
    for (const o of sc.orders) {
      const oid = newId("ord");
      orderIds.set(o.code, oid);
      await tx.insert(s.productionOrders).values({ id: oid, factoryId: f.id, planId, code: o.code, grade: o.grade, requiredTonnes: o.requiredTonnes, dueMin: o.dueMin });
    }
    const planDayStart = localDayStart(PLAN_DATE, f.timeZone);
    for (const [k, h] of dayPlan(sc.planMould, sc.orders).entries()) {
      await tx.insert(s.plannedHeats).values({
        id: newId("phe"),
        factoryId: f.id,
        planId,
        sequence: k + 1,
        heatNo: h.heatNo,
        orderId: h.orderCode ? orderIds.get(h.orderCode)! : null,
        chargeKg: h.chargeKg,
        pouredKg: h.pouredKg,
        mouldSet: h.mouldSet,
      });
      await tx.insert(s.mouldEvents).values({
        id: newId("mld"),
        factoryId: f.id,
        dayDate: PLAN_DATE,
        kind: "PLANNED",
        mouldSet: h.mouldSet,
        readyAt: planDayStart + h.mouldReadyMin * 60000,
        provenance: "SIMULATED",
      });
    }
    await tx.update(s.factories).set({ activeScenario: key }).where(eq(s.factories.id, f.id));
    await audit(tx, actor, "demo.reset", "factory", f.id, { scenario: key, note: "Simulation data regenerated. Audit history, users and other factories untouched." });
  });
  const refreshed = { ...actor, factory: { ...actor.factory, activeScenario: key } };
  await analyseFactory(db, refreshed, "demo.reset");
}

export interface SeedOptions {
  demoPassword: string;
  seedDemoUsers: boolean;
}

export const DEMO_USERS = [
  { email: "owner@foundry-a.test", name: "Asha Kulkarni", role: "OWNER" as const },
  { email: "supervisor@foundry-a.test", name: "Ravi Patil", role: "SUPERVISOR" as const },
  { email: "operator@foundry-a.test", name: "Sunil Jadhav", role: "OPERATOR" as const },
  { email: "analyst@foundry-a.test", name: "Meera Desai", role: "ANALYST" as const },
];

/** Create organisations, factories, assets and users if they do not exist. Idempotent. */
export async function seedBase(db: DB, opts: SeedOptions) {
  const existing = await db.query.factories.findFirst({ where: eq(s.factories.code, "FDY-A-SIM") });
  if (existing) return { factoryAId: existing.id, created: false };
  const orgA = "org_foundry_a";
  const orgB = "org_foundry_b";
  const factoryA = "fac_foundry_a_sim";
  const factoryB = "fac_foundry_b";
  await db.transaction(async (tx) => {
    await tx.insert(s.organizations).values([
      { id: orgA, name: "Foundry A (synthetic)" },
      { id: orgB, name: "Foundry B" },
    ]);
    await tx.insert(s.factories).values([
      {
        id: factoryA,
        orgId: orgA,
        name: "Foundry A — Kolhapur (synthetic)",
        code: "FDY-A-SIM",
        location: "Kolhapur cluster profile (synthetic plant)",
        timeZone: "Asia/Kolkata",
        isSimulation: true,
      },
      {
        id: factoryB,
        orgId: orgB,
        name: "Foundry B — Pune",
        code: "FDY-B",
        location: "Real-data workspace (empty until a meter or CSV is connected)",
        timeZone: "Asia/Kolkata",
        isSimulation: false,
      },
    ]);
    await tx.insert(s.furnaces).values([
      { id: "fur_a_f1", factoryId: factoryA, name: "F1 induction furnace", capacityKg: 500, ratedKw: 550, nominalMeltMinutes: 35 },
      { id: "fur_b_f1", factoryId: factoryB, name: "F1 induction furnace", capacityKg: 1000, ratedKw: 900, nominalMeltMinutes: 45 },
    ]);
    await tx.insert(s.meters).values([
      { id: "mtr_a_f1", factoryId: factoryA, furnaceId: "fur_a_f1", name: "F1 incomer meter", model: "Simulated (stands in for a Modbus multifunction meter)", intervalSeconds: 60 },
      { id: "mtr_b_f1", factoryId: factoryB, furnaceId: "fur_b_f1", name: "F1 incomer meter", model: "Not yet connected", intervalSeconds: 60 },
    ]);
    for (const sc of Object.values(SCENARIOS)) {
      await tx.insert(s.simulationScenarios).values({
        key: sc.key,
        name: sc.name,
        summary: sc.summary,
        purpose: sc.purpose,
        seed: BASE_SEED,
        config: { asRunMould: sc.asRunMould, planMould: sc.planMould, deadlineMin: sc.planDeadlineMin, downtime: sc.planDowntime, orders: sc.orders, meterDefects: sc.meterDefects },
      });
    }
    if (opts.seedDemoUsers) {
      const hash = await hashPassword(opts.demoPassword);
      for (const u of DEMO_USERS) {
        const uid = `usr_${u.role.toLowerCase()}_a`;
        await tx.insert(s.users).values({ id: uid, email: u.email, name: u.name, passwordHash: hash });
        await tx.insert(s.memberships).values({ id: newId("mem"), userId: uid, factoryId: factoryA, role: u.role });
      }
      // The owner also owns Foundry B, to show the factory selector.
      await tx.insert(s.memberships).values({ id: newId("mem"), userId: "usr_owner_a", factoryId: factoryB, role: "OWNER" });
      // A user who belongs only to Foundry B: used to demonstrate tenant isolation.
      await tx.insert(s.users).values({ id: "usr_owner_b", email: "owner@foundry-b.test", name: "Vikram Shinde", passwordHash: hash });
      await tx.insert(s.memberships).values({ id: newId("mem"), userId: "usr_owner_b", factoryId: factoryB, role: "OWNER" });
    }
    await audit(tx, null, "seed.base", "organization", orgA, { factories: [factoryA, factoryB] }, factoryA);
  });
  return { factoryAId: factoryA, created: true };
}

export async function scenarioList(db: DB) {
  return db.select().from(s.simulationScenarios);
}

export async function factoryHasData(db: DB, factoryId: string) {
  const h = await db.query.heats.findFirst({ where: and(eq(s.heats.factoryId, factoryId)) });
  return Boolean(h);
}
