import { and, asc, desc, eq, gte, inArray, lt, lte } from "drizzle-orm";
import type { DB } from "@/db/client";
import { anomalies, approvals, auditEvents, heats, meterReadings, productionPlans, recommendations, users } from "@/db/schema";
import { addDays, formatLocalDateTime, isIsoDate, localDayStart } from "@/domain/time";
import type { Actor } from "../context";
import { requirePerm } from "../context";
import { audit } from "../audit";
import { validation } from "../errors";
import { loadTariffVersions } from "./common";
import { rateAt } from "@/domain/tariff";

export const EXPORT_KINDS = ["heats", "readings", "anomalies", "recommendations", "audit"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];
const MAX_EXPORT_DAYS = 31;
const MAX_EXPORT_ROWS = 60_000;

/** Quote a CSV cell; neutralise spreadsheet formula injection in text cells. */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(Math.round(v * 10000) / 10000) : "";
  if (typeof v === "boolean") return v ? "true" : "false";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(meta: Record<string, string>, header: string[], rows: unknown[][]): string {
  const lines = Object.entries(meta).map(([k, v]) => `# ${k}: ${v.replace(/[\r\n]+/g, " ")}`);
  lines.push(header.map(csvCell).join(","));
  for (const r of rows) lines.push(r.map(csvCell).join(","));
  return lines.join("\n") + "\n";
}

export async function buildExport(db: DB, actor: Actor, kind: string, fromDay: string, toDay: string): Promise<{ filename: string; csv: string }> {
  requirePerm(actor, "export");
  if (!(EXPORT_KINDS as readonly string[]).includes(kind)) throw validation("Unknown export.");
  if (!isIsoDate(fromDay) || !isIsoDate(toDay) || fromDay > toDay) throw validation("Choose a valid date range.");
  const days = (Date.parse(toDay) - Date.parse(fromDay)) / 86400000 + 1;
  if (days > MAX_EXPORT_DAYS) throw validation(`Exports are limited to ${MAX_EXPORT_DAYS} days at a time.`);
  const f = actor.factory;
  const tz = f.timeZone;
  const from = localDayStart(fromDay, tz);
  const to = localDayStart(addDays(toDay, 1), tz);
  const meta: Record<string, string> = {
    "FactoryTwin EnergyOS export": kind,
    Factory: `${f.name} (${f.code})`,
    Period: `${fromDay} to ${toDay} (${tz})`,
    "Generated at": `${formatLocalDateTime(Date.now(), tz)} ${tz} by ${actor.name} (${actor.role})`,
    "Data mode": f.isSimulation ? "SIMULATION — SYNTHETIC DATA — NOT FIELD VALIDATION" : "Factory data; see provenance column",
    Units: "energy kWh; power kW; mass kg; money INR; times factory-local",
  };
  let header: string[] = [];
  let rows: unknown[][] = [];
  const t = (ts: number | null) => (ts === null ? "" : formatLocalDateTime(ts, tz));

  if (kind === "heats") {
    const hs = await db
      .select()
      .from(heats)
      .where(and(eq(heats.factoryId, f.id), gte(heats.dayDate, fromDay), lte(heats.dayDate, toDay)))
      .orderBy(asc(heats.startAt));
    meta.Calculation = "SEC = meter kWh / poured t; variance = meter kWh − expected kWh (model, hold = 0)";
    header = ["day", "heat_no", "grade", "order", "charge_kg", "poured_kg", "start", "metal_ready", "tap", "mould_set", "mould_ready", "meter_kwh", "manual_kwh", "expected_kwh", "variance_kwh", "sec_kwh_per_t", "holding_min", "holding_kwh", "reading_completeness", "data_quality", "provenance", "notes"];
    rows = hs.map((h) => {
      const kwh = h.meterKwh ?? h.manualKwh;
      return [
        h.dayDate, h.heatNo, h.grade, h.orderCode, h.chargeKg, h.pouredKg, t(h.startAt), t(h.meltEndAt), t(h.tapAt), h.mouldSet, t(h.mouldReadyAt),
        h.meterKwh, h.manualKwh, h.expectedKwh, kwh !== null && h.expectedKwh !== null ? kwh - h.expectedKwh : null,
        kwh !== null && h.pouredKg ? kwh / (h.pouredKg / 1000) : null, h.holdingMinutes, h.holdingKwh, h.readingCompleteness, h.dataQuality, h.provenance, h.operatorNotes,
      ];
    });
  } else if (kind === "readings") {
    const versions = await loadTariffVersions(db, f.id);
    const rs = await db
      .select()
      .from(meterReadings)
      .where(and(eq(meterReadings.factoryId, f.id), gte(meterReadings.ts, from), lt(meterReadings.ts, to)))
      .orderBy(asc(meterReadings.ts))
      .limit(MAX_EXPORT_ROWS + 1);
    if (rs.length > MAX_EXPORT_ROWS) throw validation(`More than ${MAX_EXPORT_ROWS.toLocaleString()} readings; choose a shorter range.`);
    meta.Calculation = "interval cost INR = energy_kwh × rate in force at the interval start";
    header = ["timestamp_local", "timestamp_utc", "meter_id", "power_kw", "energy_kwh", "rate_inr_per_kwh", "interval_cost_inr", "quality", "quality_note", "provenance", "import_batch"];
    rows = rs.map((r) => {
      const rate = rateAt(versions, r.ts);
      return [t(r.ts), new Date(r.ts).toISOString(), r.meterId, r.powerKw, r.energyKwh, rate ? rate.ratePaise / 100 : null, rate ? (r.energyKwh * rate.ratePaise) / 100 : null, r.quality, r.qualityNote, r.provenance, r.importBatchId];
    });
  } else if (kind === "anomalies") {
    const rs = await db
      .select({ a: anomalies, h: heats })
      .from(anomalies)
      .innerJoin(heats, eq(heats.id, anomalies.heatId))
      .where(and(eq(anomalies.factoryId, f.id), gte(heats.dayDate, fromDay), lte(heats.dayDate, toDay)))
      .orderBy(asc(heats.startAt));
    header = ["day", "heat_no", "expected_kwh", "actual_kwh", "variance_kwh", "variance_pct", "threshold_kwh", "severity", "evidence_level", "explanation", "rule", "model_version", "status", "provenance"];
    rows = rs.map(({ a, h }) => [h.dayDate, h.heatNo, a.expectedKwh, a.actualKwh, a.varianceKwh, a.variancePct, a.thresholdKwh, a.severity, a.evidenceLevel, a.explanation, a.rule, a.modelVersion, a.status, a.provenance]);
  } else if (kind === "recommendations") {
    const rs = await db
      .select({ r: recommendations, plan: productionPlans })
      .from(recommendations)
      .innerJoin(productionPlans, eq(productionPlans.id, recommendations.planId))
      .where(and(eq(recommendations.factoryId, f.id), gte(productionPlans.planDate, fromDay), lte(productionPlans.planDate, toDay)))
      .orderBy(desc(recommendations.createdAt));
    const ap = rs.length
      ? await db
          .select({ a: approvals, name: users.name })
          .from(approvals)
          .leftJoin(users, eq(users.id, approvals.actorId))
          .where(inArray(approvals.recommendationId, rs.map((x) => x.r.id)))
      : [];
    meta.Note = "Predicted figures are MODELLED by the optimiser, not achieved savings.";
    header = ["plan_date", "version", "status", "summary", "predicted_kwh_delta", "predicted_cost_inr_delta", "input_hash", "created", "decision", "decided_by", "role", "decided_at", "reason"];
    rows = rs.map(({ r, plan }) => {
      const a = ap.find((x) => x.a.recommendationId === r.id);
      const d = (r.predicted as { delta?: { kwh?: number; costPaise?: number } }).delta;
      return [plan.planDate, r.version, r.status, r.summary, d?.kwh, d?.costPaise !== undefined ? d.costPaise / 100 : null, r.inputHash, t(r.createdAt), a?.a.decision, a?.name, a?.a.actorRole, a ? t(a.a.decidedAt) : "", a?.a.reason];
    });
  } else {
    requirePerm(actor, "audit.view");
    const rs = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.factoryId, f.id), gte(auditEvents.createdAt, from), lt(auditEvents.createdAt, to)))
      .orderBy(asc(auditEvents.createdAt))
      .limit(MAX_EXPORT_ROWS);
    header = ["time", "actor", "action", "entity", "entity_id", "details_json"];
    rows = rs.map((e) => [t(e.createdAt), e.actorName, e.action, e.entity, e.entityId, JSON.stringify(e.details)]);
  }
  await audit(db, actor, "export.csv", "export", kind, { fromDay, toDay, rows: rows.length });
  return { filename: `energyos_${f.code}_${kind}_${fromDay}_${toDay}.csv`, csv: toCsv(meta, header, rows) };
}
