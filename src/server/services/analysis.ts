import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import type { DB } from "@/db/client";
import { anomalies, heats, meterReadings, modelFits } from "@/db/schema";
import { analyseHeat, ANOMALY_RULE, type HeatAnalysis } from "@/domain/anomaly";
import { fitModel, physicsPrior, type FitRow, type EnergyModel } from "@/domain/model";
import { segmentTrace } from "@/domain/anomaly";
import { addDays, localDayStart } from "@/domain/time";
import type { Actor } from "../context";
import { requirePerm } from "../context";
import { audit } from "../audit";
import { newId } from "../ids";
import { latestModel, requireFurnace, primaryMeter } from "./common";

export interface AnalysisSummary {
  heatsAnalysed: number;
  anomaliesFlagged: number;
  model: EnergyModel;
  modelFitId: string;
  fromDay: string;
  toDay: string;
}

/**
 * Run the full analysis for a day range: link meter energy to heats, measure
 * holding from the trace, refit the expected-energy model on clean history, and
 * store explainable anomalies. Idempotent: re-running replaces earlier results.
 */
export async function runAnalysis(db: DB, actor: Actor): Promise<AnalysisSummary> {
  requirePerm(actor, "analysis.run");
  return analyseFactory(db, actor, "analysis.run");
}

/**
 * Internal: refresh heat metrics and anomalies after data changes (heat edits,
 * imports, recorded outcomes). The model is always refitted on all clean history
 * (bounded to the last 120 days) so a single new day never fits on its own.
 */
export async function analyseFactory(db: DB, actor: Actor, reason: string): Promise<AnalysisSummary> {
  const opts: { fromDay?: string; toDay?: string } = {};
  const f = actor.factory;
  const furnace = await requireFurnace(db, f.id);
  const meter = await primaryMeter(db, f.id);
  const intervalSeconds = meter?.intervalSeconds ?? 60;
  const latest = await db.select({ d: heats.dayDate }).from(heats).where(eq(heats.factoryId, f.id)).orderBy(desc(heats.dayDate)).limit(1);
  if (latest[0]) opts.fromDay = addDays(latest[0].d, -120);

  const heatRows = await db
    .select()
    .from(heats)
    .where(
      and(
        eq(heats.factoryId, f.id),
        opts.fromDay ? gte(heats.dayDate, opts.fromDay) : undefined,
        opts.toDay ? lte(heats.dayDate, opts.toDay) : undefined,
      ),
    )
    .orderBy(asc(heats.startAt));

  const fromDay = opts.fromDay ?? heatRows[0]?.dayDate ?? "1970-01-01";
  const toDay = opts.toDay ?? heatRows[heatRows.length - 1]?.dayDate ?? fromDay;
  const windowFrom = localDayStart(fromDay, f.timeZone);
  const windowTo = localDayStart(addDays(toDay, 1), f.timeZone);
  const readings = await db
    .select({ ts: meterReadings.ts, powerKw: meterReadings.powerKw, energyKwh: meterReadings.energyKwh, quality: meterReadings.quality })
    .from(meterReadings)
    .where(and(eq(meterReadings.factoryId, f.id), gte(meterReadings.ts, windowFrom), lte(meterReadings.ts, windowTo)))
    .orderBy(asc(meterReadings.ts));
  const valid = readings.filter((r) => r.quality !== "INVALID");

  // Slice readings per heat with a moving pointer (heats sorted by start).
  const cfg = {
    ratedKw: furnace.ratedKw,
    holdingKw: f.holdingKw,
    nominalMeltMinutes: furnace.nominalMeltMinutes,
    intervalSeconds,
    timeZone: f.timeZone,
  };
  const pointsFor = (start: number, end: number) => {
    let lo = 0;
    let hi = valid.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (valid[mid].ts < start) lo = mid + 1;
      else hi = mid;
    }
    const out: { ts: number; powerKw: number; energyKwh: number }[] = [];
    for (let i = lo; i < valid.length && valid[i].ts < end; i++) out.push(valid[i]);
    return out;
  };

  // Pass 1: meter energy, holding and cold-start for every heat.
  const prepared = heatRows.map((h, i) => {
    const prev = i > 0 && heatRows[i - 1].dayDate === h.dayDate ? heatRows[i - 1] : null;
    const coldStart = !prev || prev.tapAt === null || h.startAt - prev.tapAt > f.coldGapMinutes * 60000;
    if (h.tapAt === null) return { h, coldStart, pts: [], kwh: null as number | null, hold: null as number | null, holdKwh: null as number | null, comp: null as number | null };
    const pts = pointsFor(h.startAt, h.tapAt);
    const slots = Math.max(1, Math.round((h.tapAt - h.startAt) / (intervalSeconds * 1000)));
    const comp = Math.min(1, pts.length / slots);
    const phases = segmentTrace(pts, h.startAt, h.tapAt, cfg);
    const meltIdx = phases.map((p) => p.kind).lastIndexOf("MELT");
    const holdPhases = meltIdx >= 0 ? phases.slice(meltIdx + 1).filter((p) => p.kind === "HOLD" && p.minutes >= 3) : [];
    return {
      h,
      coldStart,
      pts,
      kwh: pts.length ? pts.reduce((s, p) => s + p.energyKwh, 0) : null,
      hold: holdPhases.reduce((s, p) => s + p.minutes, 0),
      holdKwh: holdPhases.reduce((s, p) => s + p.kwh, 0),
      comp,
    };
  });

  // Pass 2: fit the model on complete heats.
  const fitRows: FitRow[] = prepared
    .filter((p) => p.kwh !== null && p.comp !== null && p.comp >= 0.98 && p.hold !== null)
    .map((p) => ({ kwh: p.kwh!, chargeTonnes: p.h.chargeKg / 1000, coldStart: p.coldStart, holdMinutes: p.hold! }));
  const prior = physicsPrior(furnace.ratedKw, furnace.nominalMeltMinutes, furnace.capacityKg / 1000, f.coldExtraMinutes, f.holdingKw);
  const model = fitModel(fitRows, prior);

  // Pass 3: explain each heat.
  const results: { p: (typeof prepared)[number]; a: HeatAnalysis | null }[] = prepared.map((p) => ({
    p,
    a:
      p.h.tapAt === null
        ? null
        : analyseHeat(
            {
              id: p.h.id,
              heatNo: p.h.heatNo,
              startAt: p.h.startAt,
              tapAt: p.h.tapAt,
              chargeKg: p.h.chargeKg,
              coldStart: p.coldStart,
              mouldSet: p.h.mouldSet,
              mouldReadyAt: p.h.mouldReadyAt,
              meltEndAt: p.h.meltEndAt,
            },
            p.pts,
            model,
            cfg,
          ),
  }));

  const fitId = newId("fit");
  const now = Date.now();
  let flaggedCount = 0;
  await db.transaction(async (tx) => {
    await tx.insert(modelFits).values({
      id: fitId,
      factoryId: f.id,
      version: model.version,
      kind: model.kind,
      coefficients: model.coefficients,
      n: model.n,
      r2: model.r2,
      rmseKwh: model.rmseKwh,
      note: model.note,
    });
    const ids = heatRows.map((h) => h.id);
    const previous = ids.length
      ? await tx.select({ heatId: anomalies.heatId, status: anomalies.status }).from(anomalies).where(and(eq(anomalies.factoryId, f.id), inArray(anomalies.heatId, ids)))
      : [];
    const prevStatus = new Map(previous.map((r) => [r.heatId, r.status]));
    for (let i = 0; i < ids.length; i += 400) {
      await tx.delete(anomalies).where(and(eq(anomalies.factoryId, f.id), inArray(anomalies.heatId, ids.slice(i, i + 400)), eq(anomalies.rule, ANOMALY_RULE)));
    }
    for (const { p, a } of results) {
      const quality = p.h.tapAt === null ? "OPEN" : p.comp === null || p.comp === 0 ? "NO_METER_DATA" : p.comp >= 0.98 ? "COMPLETE" : "PARTIAL";
      await tx
        .update(heats)
        .set({
          meterKwh: p.kwh,
          expectedKwh: a?.expectedKwh ?? null,
          holdingMinutes: p.hold,
          holdingKwh: p.holdKwh,
          readingCompleteness: p.comp,
          dataQuality: quality,
          coldStart: p.coldStart,
        })
        .where(eq(heats.id, p.h.id));
      if (a && a.flagged) {
        flaggedCount++;
        await tx.insert(anomalies).values({
          id: newId("anm"),
          factoryId: f.id,
          heatId: p.h.id,
          modelFitId: fitId,
          rule: a.rule,
          modelVersion: a.modelVersion,
          expectedKwh: a.expectedKwh,
          actualKwh: a.actualKwh,
          varianceKwh: a.varianceKwh,
          variancePct: a.variancePct,
          thresholdKwh: a.thresholdKwh,
          severity: a.severity,
          evidenceLevel: a.evidenceLevel,
          explanation: a.explanation,
          findings: a.findings,
          investigation: a.suggestedInvestigation,
          status: prevStatus.get(p.h.id) ?? "OPEN",
          provenance: p.h.provenance,
          detectedAt: now,
        });
      }
    }
    await audit(tx, actor, reason === "analysis.run" ? "analysis.run" : "analysis.refresh", "model_fit", fitId, {
      trigger: reason,
      fromDay,
      toDay,
      heats: heatRows.length,
      flagged: flaggedCount,
      model: { kind: model.kind, n: model.n, r2: model.r2, rmseKwh: model.rmseKwh },
    });
  });
  return { heatsAnalysed: heatRows.length, anomaliesFlagged: flaggedCount, model, modelFitId: fitId, fromDay, toDay };
}

/** Recompute the analysis of a single heat (after an edit) using the latest model. */
export async function heatAnalysisDetail(db: DB, actor: Actor, heatId: string) {
  requirePerm(actor, "view");
  const f = actor.factory;
  const h = await db.query.heats.findFirst({ where: and(eq(heats.id, heatId), eq(heats.factoryId, f.id)) });
  if (!h) return null;
  const furnace = await requireFurnace(db, f.id);
  const meter = await primaryMeter(db, f.id);
  const { model, fitId, createdAt } = await latestModel(db, f.id, furnace, f);
  const anomaly = await db.query.anomalies.findFirst({ where: and(eq(anomalies.heatId, h.id), eq(anomalies.factoryId, f.id)) });
  if (h.tapAt === null) return { heat: h, analysis: null, model, fitId, fitCreatedAt: createdAt, anomaly: anomaly ?? null, points: [] as { ts: number; powerKw: number; energyKwh: number }[] };
  const pad = 15 * 60000;
  const pts = await db
    .select({ ts: meterReadings.ts, powerKw: meterReadings.powerKw, energyKwh: meterReadings.energyKwh, quality: meterReadings.quality })
    .from(meterReadings)
    .where(and(eq(meterReadings.factoryId, f.id), gte(meterReadings.ts, h.startAt - pad), lte(meterReadings.ts, h.tapAt + pad)))
    .orderBy(asc(meterReadings.ts));
  const valid = pts.filter((p) => p.quality !== "INVALID");
  const analysis = analyseHeat(
    {
      id: h.id,
      heatNo: h.heatNo,
      startAt: h.startAt,
      tapAt: h.tapAt,
      chargeKg: h.chargeKg,
      coldStart: h.coldStart,
      mouldSet: h.mouldSet,
      mouldReadyAt: h.mouldReadyAt,
      meltEndAt: h.meltEndAt,
    },
    valid,
    model,
    {
      ratedKw: furnace.ratedKw,
      holdingKw: f.holdingKw,
      nominalMeltMinutes: furnace.nominalMeltMinutes,
      intervalSeconds: meter?.intervalSeconds ?? 60,
      timeZone: f.timeZone,
    },
  );
  return { heat: h, analysis, model, fitId, fitCreatedAt: createdAt, anomaly: anomaly ?? null, points: valid };
}
