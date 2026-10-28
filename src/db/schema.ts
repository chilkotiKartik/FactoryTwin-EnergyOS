import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Schema notes
 * - Timestamps are UTC epoch milliseconds (integer). Local dates are YYYY-MM-DD text
 *   in the factory's time zone, used for day grouping.
 * - Money is stored as integer paise; tariff rates as integer paise per kWh.
 * - Every operational row carries factory_id for tenant scoping; queries always
 *   filter on it after a server-side membership check.
 */

const id = () => text("id").primaryKey();
const createdAt = () =>
  integer("created_at")
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`);

export const organizations = sqliteTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const users = sqliteTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: createdAt(),
});

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(), // SHA-256 of the cookie token
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    activeFactoryId: text("active_factory_id"),
    expiresAt: integer("expires_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const factories = sqliteTable("factories", {
  id: id(),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  location: text("location").notNull().default(""),
  timeZone: text("time_zone").notNull().default("Asia/Kolkata"),
  isSimulation: integer("is_simulation", { mode: "boolean" }).notNull().default(false),
  activeScenario: text("active_scenario"),
  holdingKw: real("holding_kw").notNull().default(60),
  emissionFactor: real("emission_factor_kg_per_kwh").notNull().default(0.727),
  emissionFactorSource: text("emission_factor_source").notNull().default("CEA CO2 Baseline Database v20.0, FY 2023-24 weighted average (as cited in deck)"),
  turnaroundMinutes: integer("turnaround_minutes").notNull().default(10),
  coldGapMinutes: integer("cold_gap_minutes").notNull().default(60),
  coldExtraMinutes: integer("cold_extra_minutes").notNull().default(5),
  maxHoldMinutes: integer("max_hold_minutes").notNull().default(60),
  minCompleteness: real("min_completeness").notNull().default(0.98),
  gridMinutes: integer("grid_minutes").notNull().default(5),
  createdAt: createdAt(),
});

export const ROLES = ["OWNER", "SUPERVISOR", "OPERATOR", "ANALYST"] as const;
export type Role = (typeof ROLES)[number];

export const memberships = sqliteTable(
  "memberships",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    factoryId: text("factory_id")
      .notNull()
      .references(() => factories.id, { onDelete: "cascade" }),
    role: text("role", { enum: ROLES }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("memberships_user_factory_uq").on(t.userId, t.factoryId)],
);

export const furnaces = sqliteTable("furnaces", {
  id: id(),
  factoryId: text("factory_id")
    .notNull()
    .references(() => factories.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  capacityKg: real("capacity_kg").notNull(),
  ratedKw: real("rated_kw").notNull(),
  nominalMeltMinutes: integer("nominal_melt_minutes").notNull(),
  availableFromMin: integer("available_from_min").notNull().default(360),
  availableToMin: integer("available_to_min").notNull().default(1320),
  maxHeatsPerDay: integer("max_heats_per_day").notNull().default(14),
  status: text("status", { enum: ["AVAILABLE", "MAINTENANCE"] }).notNull().default("AVAILABLE"),
  createdAt: createdAt(),
});

export const meters = sqliteTable("meters", {
    id: id(),
    factoryId: text("factory_id")
      .notNull()
      .references(() => factories.id, { onDelete: "cascade" }),
    furnaceId: text("furnace_id").references(() => furnaces.id),
    name: text("name").notNull(),
    model: text("model").notNull().default(""),
    intervalSeconds: integer("interval_seconds").notNull().default(60),
    ingestTokenHash: text("ingest_token_hash"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("meters_ingest_token_uq").on(t.ingestTokenHash)],
);

export const PROVENANCE = ["SIMULATED", "MEASURED", "MANUAL", "IMPORTED_UNVERIFIED"] as const;

export const importBatches = sqliteTable("import_batches", {
  id: id(),
  factoryId: text("factory_id")
    .notNull()
    .references(() => factories.id, { onDelete: "cascade" }),
  meterId: text("meter_id")
    .notNull()
    .references(() => meters.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  provenance: text("provenance", { enum: PROVENANCE }).notNull(),
  rowsTotal: integer("rows_total").notNull(),
  rowsAccepted: integer("rows_accepted").notNull(),
  rowsRejected: integer("rows_rejected").notNull(),
  rowsDuplicate: integer("rows_duplicate").notNull(),
  issues: text("issues", { mode: "json" }).$type<{ row: number; message: string }[]>().notNull().default([]),
  createdBy: text("created_by").references(() => users.id),
  createdAt: createdAt(),
});

export const meterReadings = sqliteTable(
  "meter_readings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    factoryId: text("factory_id")
      .notNull()
      .references(() => factories.id, { onDelete: "cascade" }),
    meterId: text("meter_id")
      .notNull()
      .references(() => meters.id, { onDelete: "cascade" }),
    ts: integer("ts").notNull(),
    powerKw: real("power_kw").notNull(),
    energyKwh: real("energy_kwh").notNull(),
    quality: text("quality", { enum: ["OK", "SUSPECT", "INVALID"] }).notNull().default("OK"),
    qualityNote: text("quality_note"),
    provenance: text("provenance", { enum: PROVENANCE }).notNull(),
    importBatchId: text("import_batch_id"),
  },
  (t) => [uniqueIndex("readings_meter_ts_uq").on(t.meterId, t.ts), index("readings_factory_ts_idx").on(t.factoryId, t.ts)],
);

export const productionPlans = sqliteTable(
  "production_plans",
  {
    id: id(),
    factoryId: text("factory_id")
      .notNull()
      .references(() => factories.id, { onDelete: "cascade" }),
    furnaceId: text("furnace_id")
      .notNull()
      .references(() => furnaces.id),
    planDate: text("plan_date").notNull(),
    deadlineMin: integer("deadline_min").notNull(),
    currentPracticeStartMin: integer("current_practice_start_min").notNull().default(360),
    downtime: text("downtime", { mode: "json" }).$type<{ fromMin: number; toMin: number; reason: string }[]>().notNull().default([]),
    notes: text("notes").notNull().default(""),
    provenance: text("provenance", { enum: PROVENANCE }).notNull(),
    revision: integer("revision").notNull().default(1),
    updatedAt: integer("updated_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("plans_factory_date_uq").on(t.factoryId, t.furnaceId, t.planDate)],
);

export const productionOrders = sqliteTable(
  "production_orders",
  {
    id: id(),
    factoryId: text("factory_id")
      .notNull()
      .references(() => factories.id, { onDelete: "cascade" }),
    planId: text("plan_id")
      .notNull()
      .references(() => productionPlans.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    grade: text("grade").notNull(),
    requiredTonnes: real("required_tonnes").notNull(),
    dueMin: integer("due_min").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("orders_plan_code_uq").on(t.planId, t.code)],
);

/** Planned heats for a plan (inputs to the optimiser). */
export const plannedHeats = sqliteTable(
  "planned_heats",
  {
    id: id(),
    factoryId: text("factory_id")
      .notNull()
      .references(() => factories.id, { onDelete: "cascade" }),
    planId: text("plan_id")
      .notNull()
      .references(() => productionPlans.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    heatNo: text("heat_no").notNull(),
    orderId: text("order_id").references(() => productionOrders.id),
    chargeKg: real("charge_kg").notNull(),
    pouredKg: real("poured_kg").notNull(),
    mouldSet: integer("mould_set"),
  },
  (t) => [uniqueIndex("planned_heats_plan_seq_uq").on(t.planId, t.sequence)],
);

/** Mould-readiness events: planned (for a plan) or recorded (for a day that ran). */
export const mouldEvents = sqliteTable(
  "mould_events",
  {
    id: id(),
    factoryId: text("factory_id")
      .notNull()
      .references(() => factories.id, { onDelete: "cascade" }),
    dayDate: text("day_date").notNull(),
    kind: text("kind", { enum: ["PLANNED", "RECORDED"] }).notNull(),
    mouldSet: integer("mould_set").notNull(),
    readyAt: integer("ready_at").notNull(),
    provenance: text("provenance", { enum: PROVENANCE }).notNull(),
    note: text("note").notNull().default(""),
  },
  (t) => [uniqueIndex("mould_factory_day_kind_set_uq").on(t.factoryId, t.dayDate, t.kind, t.mouldSet)],
);

export const scheduleVersions = sqliteTable(
  "schedule_versions",
  {
    id: id(),
    factoryId: text("factory_id")
      .notNull()
      .references(() => factories.id, { onDelete: "cascade" }),
    planId: text("plan_id")
      .notNull()
      .references(() => productionPlans.id, { onDelete: "cascade" }),
    optimizationRunId: text("optimization_run_id"),
    kind: text("kind", { enum: ["CURRENT_PRACTICE", "RECOMMENDED"] }).notNull(),
    status: text("status", { enum: ["ACTIVE", "PROPOSED", "SUPERSEDED", "REJECTED"] }).notNull(),
    version: integer("version").notNull(),
    totals: text("totals", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("schedule_versions_plan_idx").on(t.planId)],
);

export const scheduleItems = sqliteTable("schedule_items", {
  id: id(),
  scheduleVersionId: text("schedule_version_id")
    .notNull()
    .references(() => scheduleVersions.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  heatNo: text("heat_no").notNull(),
  orderId: text("order_id"),
  mouldSet: integer("mould_set"),
  mouldReadyMin: integer("mould_ready_min"),
  startMin: integer("start_min").notNull(),
  meltEndMin: integer("melt_end_min").notNull(),
  tapMin: integer("tap_min").notNull(),
  holdMin: integer("hold_min").notNull(),
  cold: integer("cold", { mode: "boolean" }).notNull(),
  meltKwh: real("melt_kwh").notNull(),
  holdKwh: real("hold_kwh").notNull(),
  costPaise: real("cost_paise").notNull(),
  chargeKg: real("charge_kg").notNull(),
  pouredKg: real("poured_kg").notNull(),
});

/** Heats that actually ran (as-run log). */
export const heats = sqliteTable(
  "heats",
  {
    id: id(),
    factoryId: text("factory_id")
      .notNull()
      .references(() => factories.id, { onDelete: "cascade" }),
    furnaceId: text("furnace_id")
      .notNull()
      .references(() => furnaces.id),
    dayDate: text("day_date").notNull(),
    heatNo: text("heat_no").notNull(),
    grade: text("grade").notNull().default(""),
    orderCode: text("order_code"),
    chargeKg: real("charge_kg").notNull(),
    pouredKg: real("poured_kg"),
    startAt: integer("start_at").notNull(),
    meltEndAt: integer("melt_end_at"),
    tapAt: integer("tap_at"),
    mouldSet: integer("mould_set"),
    mouldReadyAt: integer("mould_ready_at"),
    coldStart: integer("cold_start", { mode: "boolean" }).notNull().default(false),
    meterKwh: real("meter_kwh"),
    manualKwh: real("manual_kwh"),
    expectedKwh: real("expected_kwh"),
    holdingMinutes: real("holding_minutes"),
    holdingKwh: real("holding_kwh"),
    readingCompleteness: real("reading_completeness"),
    dataQuality: text("data_quality", { enum: ["COMPLETE", "PARTIAL", "NO_METER_DATA", "OPEN", "NOT_ANALYSED"] })
      .notNull()
      .default("NOT_ANALYSED"),
    operatorNotes: text("operator_notes").notNull().default(""),
    provenance: text("provenance", { enum: PROVENANCE }).notNull(),
    executionId: text("execution_id"),
    createdBy: text("created_by"),
    updatedBy: text("updated_by"),
    revision: integer("revision").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("heats_factory_day_no_uq").on(t.factoryId, t.dayDate, t.heatNo),
    index("heats_factory_start_idx").on(t.factoryId, t.startAt),
  ],
);

export const tariffVersions = sqliteTable(
  "tariff_versions",
  {
    id: id(),
    factoryId: text("factory_id")
      .notNull()
      .references(() => factories.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    name: text("name").notNull(),
    effectiveFrom: integer("effective_from").notNull(),
    timeZone: text("time_zone").notNull(),
    normalRatePaise: integer("normal_rate_paise").notNull(),
    evidence: text("evidence", { enum: ["ASSUMPTION", "VERIFIED"] }).notNull().default("ASSUMPTION"),
    sourceNote: text("source_note").notNull().default(""),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("tariff_factory_version_uq").on(t.factoryId, t.version)],
);

export const tariffPeriods = sqliteTable("tariff_periods", {
    id: id(),
    tariffVersionId: text("tariff_version_id")
      .notNull()
      .references(() => tariffVersions.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["PEAK", "SOLAR", "OFFPEAK"] }).notNull(),
    label: text("label").notNull(),
    startMin: integer("start_min").notNull(),
    endMin: integer("end_min").notNull(),
    ratePaise: integer("rate_paise").notNull(),
  },
  (t) => [index("tariff_periods_version_idx").on(t.tariffVersionId)],
);

export const modelFits = sqliteTable("model_fits", {
    id: id(),
    factoryId: text("factory_id")
      .notNull()
      .references(() => factories.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    kind: text("kind").notNull(),
    coefficients: text("coefficients", { mode: "json" }).$type<Record<string, number>>().notNull(),
    n: integer("n").notNull(),
    r2: real("r2"),
    rmseKwh: real("rmse_kwh"),
    note: text("note").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("model_fits_factory_time_idx").on(t.factoryId, t.createdAt)],
);

export const anomalies = sqliteTable(
  "anomalies",
  {
    id: id(),
    factoryId: text("factory_id")
      .notNull()
      .references(() => factories.id, { onDelete: "cascade" }),
    heatId: text("heat_id")
      .notNull()
      .references(() => heats.id, { onDelete: "cascade" }),
    modelFitId: text("model_fit_id"),
    rule: text("rule").notNull(),
    modelVersion: text("model_version").notNull(),
    expectedKwh: real("expected_kwh").notNull(),
    actualKwh: real("actual_kwh"),
    varianceKwh: real("variance_kwh"),
    variancePct: real("variance_pct"),
    thresholdKwh: real("threshold_kwh").notNull(),
    severity: text("severity", { enum: ["HIGH", "MEDIUM", "LOW"] }),
    evidenceLevel: text("evidence_level", { enum: ["CONFIRMED", "STRONG", "HYPOTHESIS", "INSUFFICIENT"] }).notNull(),
    explanation: text("explanation").notNull(),
    findings: text("findings", { mode: "json" }).$type<unknown[]>().notNull(),
    investigation: text("investigation", { mode: "json" }).$type<string[]>().notNull(),
    status: text("status", { enum: ["OPEN", "ACKNOWLEDGED", "RESOLVED"] }).notNull().default("OPEN"),
    provenance: text("provenance", { enum: PROVENANCE }).notNull(),
    detectedAt: integer("detected_at").notNull(),
  },
  (t) => [uniqueIndex("anomalies_heat_rule_uq").on(t.heatId, t.rule), index("anomalies_factory_idx").on(t.factoryId)],
);

export const optimizationRuns = sqliteTable(
  "optimization_runs",
  {
    id: id(),
    factoryId: text("factory_id")
      .notNull()
      .references(() => factories.id, { onDelete: "cascade" }),
    planId: text("plan_id")
      .notNull()
      .references(() => productionPlans.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["OPTIMAL", "INFEASIBLE", "PAUSED_DATA_QUALITY", "ERROR"] }).notNull(),
    solver: text("solver").notNull(),
    solverVersion: text("solver_version").notNull(),
    modelVersion: text("model_version").notNull(),
    modelFitId: text("model_fit_id"),
    tariffVersionId: text("tariff_version_id"),
    inputHash: text("input_hash").notNull(),
    inputSnapshot: text("input_snapshot", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    result: text("result", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    runtimeMs: real("runtime_ms").notNull(),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => [index("runs_plan_idx").on(t.planId)],
);

export const recommendations = sqliteTable(
  "recommendations",
  {
    id: id(),
    factoryId: text("factory_id")
      .notNull()
      .references(() => factories.id, { onDelete: "cascade" }),
    planId: text("plan_id")
      .notNull()
      .references(() => productionPlans.id, { onDelete: "cascade" }),
    optimizationRunId: text("optimization_run_id")
      .notNull()
      .references(() => optimizationRuns.id, { onDelete: "cascade" }),
    proposedScheduleId: text("proposed_schedule_id")
      .notNull()
      .references(() => scheduleVersions.id),
    currentScheduleId: text("current_schedule_id")
      .notNull()
      .references(() => scheduleVersions.id),
    version: integer("version").notNull(),
    status: text("status", { enum: ["PENDING", "APPROVED", "REJECTED", "STALE", "SUPERSEDED"] }).notNull(),
    inputHash: text("input_hash").notNull(),
    inputTimestamp: integer("input_timestamp").notNull(),
    predicted: text("predicted", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    summary: text("summary").notNull(),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("recs_plan_version_uq").on(t.planId, t.version), index("recs_factory_status_idx").on(t.factoryId, t.status)],
);

export const approvals = sqliteTable(
  "approvals",
  {
    id: id(),
    factoryId: text("factory_id")
      .notNull()
      .references(() => factories.id, { onDelete: "cascade" }),
    recommendationId: text("recommendation_id")
      .notNull()
      .references(() => recommendations.id, { onDelete: "cascade" }),
    decision: text("decision", { enum: ["APPROVED", "REJECTED"] }).notNull(),
    reason: text("reason").notNull().default(""),
    actorId: text("actor_id").notNull(),
    actorRole: text("actor_role").notNull(),
    recommendationVersion: integer("recommendation_version").notNull(),
    inputHash: text("input_hash").notNull(),
    decidedAt: integer("decided_at").notNull(),
  },
  // One decision per recommendation: the database rejects a second one.
  (t) => [uniqueIndex("approvals_recommendation_uq").on(t.recommendationId)],
);

export const executionRecords = sqliteTable("execution_records", {
    id: id(),
    factoryId: text("factory_id")
      .notNull()
      .references(() => factories.id, { onDelete: "cascade" }),
    planId: text("plan_id")
      .notNull()
      .references(() => productionPlans.id, { onDelete: "cascade" }),
    scheduleVersionId: text("schedule_version_id")
      .notNull()
      .references(() => scheduleVersions.id),
    recommendationId: text("recommendation_id"),
    dayDate: text("day_date").notNull(),
    kind: text("kind", { enum: ["SIMULATED_OUTCOME", "MEASURED_OUTCOME"] }).notNull(),
    provenance: text("provenance", { enum: PROVENANCE }).notNull(),
    summary: text("summary", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => [index("executions_factory_day_idx").on(t.factoryId, t.dayDate)],
);

export const verificationReports = sqliteTable("verification_reports", {
  id: id(),
  factoryId: text("factory_id")
    .notNull()
    .references(() => factories.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  baselineDay: text("baseline_day").notNull(),
  comparisonDay: text("comparison_day").notNull(),
  executionId: text("execution_id"),
  evidenceLabel: text("evidence_label").notNull(),
  metrics: text("metrics", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  assumptions: text("assumptions", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  createdBy: text("created_by"),
  createdAt: createdAt(),
});

export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    factoryId: text("factory_id"),
    actorId: text("actor_id"),
    actorName: text("actor_name"),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    details: text("details", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("audit_factory_time_idx").on(t.factoryId, t.createdAt)],
);

export const simulationScenarios = sqliteTable("simulation_scenarios", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  summary: text("summary").notNull(),
  purpose: text("purpose").notNull(),
  seed: integer("seed").notNull(),
  config: text("config", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
});

/** A stated baseline for one factory: the reference period savings are measured against. */
export const energyBaselines = sqliteTable("energy_baselines", {
  id: id(),
  factoryId: text("factory_id")
    .notNull()
    .references(() => factories.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  method: text("method").notNull(),
  periodStartDay: text("period_start_day").notNull(),
  periodEndDay: text("period_end_day").notNull(),
  energyKwh: real("energy_kwh").notNull(),
  tonnesPoured: real("tonnes_poured").notNull(),
  costPaise: real("cost_paise").notNull(),
  holdingMinutes: real("holding_minutes").notNull(),
  completeness: real("completeness"),
  evidenceLabel: text("evidence_label").notNull(),
  createdBy: text("created_by"),
  createdAt: createdAt(),
});
