import { sql } from "drizzle-orm";
import { bigint, bigserial, boolean, doublePrecision, index, jsonb, pgTable, primaryKey, text, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Schema notes (PostgreSQL)
 * - Timestamps are UTC epoch milliseconds (bigint, read as JS numbers). Local dates are YYYY-MM-DD text
 *   in the factory's time zone, used for day grouping.
 * - Money is stored as integer paise; tariff rates as integer paise per kWh.
 * - Every operational row carries factory_id for tenant scoping; queries always
 *   filter on it after a server-side membership check.
 */

const id = () => text("id").primaryKey();
const createdAt = () =>
  bigint("created_at", { mode: "number" })
    .notNull()
    .default(sql`(extract(epoch from now()) * 1000)::bigint`);

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  /** A disabled user cannot sign in and their sessions stop working. */
  disabled: boolean("disabled").notNull().default(false),
  /** Set when an owner creates the account with a one-time password; cleared on first change. */
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  passwordChangedAt: bigint("password_changed_at", { mode: "number" }),
  createdAt: createdAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(), // SHA-256 of the cookie token
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    activeFactoryId: text("active_factory_id"),
    expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const factories = pgTable("factories", {
  id: id(),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  location: text("location").notNull().default(""),
  timeZone: text("time_zone").notNull().default("Asia/Kolkata"),
  isSimulation: boolean("is_simulation").notNull().default(false),
  activeScenario: text("active_scenario"),
  holdingKw: doublePrecision("holding_kw").notNull().default(60),
  emissionFactor: doublePrecision("emission_factor_kg_per_kwh").notNull().default(0.727),
  emissionFactorSource: text("emission_factor_source").notNull().default("CEA CO2 Baseline Database v20.0, FY 2023-24 weighted average (as cited in deck)"),
  turnaroundMinutes: bigint("turnaround_minutes", { mode: "number" }).notNull().default(10),
  coldGapMinutes: bigint("cold_gap_minutes", { mode: "number" }).notNull().default(60),
  coldExtraMinutes: bigint("cold_extra_minutes", { mode: "number" }).notNull().default(5),
  maxHoldMinutes: bigint("max_hold_minutes", { mode: "number" }).notNull().default(60),
  minCompleteness: doublePrecision("min_completeness").notNull().default(0.98),
  gridMinutes: bigint("grid_minutes", { mode: "number" }).notNull().default(5),
  /** Sanctioned / contract demand of the connection, kVA. Null = no cap is enforced. */
  siteCapKva: doublePrecision("site_cap_kva"),
  /** Site power factor used to convert kW to kVA (ASSUMPTION until measured). */
  powerFactor: doublePrecision("power_factor").notNull().default(0.95),
  /** Other plant load (everything except the furnace), kW, 06:00–22:00 and overnight. */
  baseLoadDayKw: doublePrecision("base_load_day_kw").notNull().default(0),
  baseLoadNightKw: doublePrecision("base_load_night_kw").notNull().default(0),
  /** Set when new data needs re-analysis; a job claims and clears it (durable across restarts and instances). */
  analysisRequestedAt: bigint("analysis_requested_at", { mode: "number" }),
  /** Demand charge, paise per kVA per month. Null = not modelled. */
  demandRatePaisePerKvaMonth: bigint("demand_rate_paise_per_kva_month", { mode: "number" }),
  /** Outbound alert webhook (HTTPS). Payloads are signed with HMAC-SHA256 using alertWebhookSecret. */
  alertWebhookUrl: text("alert_webhook_url"),
  alertWebhookSecret: text("alert_webhook_secret"),
  createdAt: createdAt(),
});

export const ROLES = ["OWNER", "SUPERVISOR", "OPERATOR", "ANALYST"] as const;
export type Role = (typeof ROLES)[number];

export const memberships = pgTable(
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

export const furnaces = pgTable("furnaces", {
  id: id(),
  factoryId: text("factory_id")
    .notNull()
    .references(() => factories.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  capacityKg: doublePrecision("capacity_kg").notNull(),
  ratedKw: doublePrecision("rated_kw").notNull(),
  nominalMeltMinutes: bigint("nominal_melt_minutes", { mode: "number" }).notNull(),
  availableFromMin: bigint("available_from_min", { mode: "number" }).notNull().default(360),
  availableToMin: bigint("available_to_min", { mode: "number" }).notNull().default(1320),
  maxHeatsPerDay: bigint("max_heats_per_day", { mode: "number" }).notNull().default(14),
  status: text("status", { enum: ["AVAILABLE", "MAINTENANCE"] }).notNull().default("AVAILABLE"),
  createdAt: createdAt(),
});

export const meters = pgTable("meters", {
    id: id(),
    factoryId: text("factory_id")
      .notNull()
      .references(() => factories.id, { onDelete: "cascade" }),
    furnaceId: text("furnace_id").references(() => furnaces.id),
    name: text("name").notNull(),
    model: text("model").notNull().default(""),
    intervalSeconds: bigint("interval_seconds", { mode: "number" }).notNull().default(60),
    ingestTokenHash: text("ingest_token_hash"),
    ingestTokenIssuedAt: bigint("ingest_token_issued_at", { mode: "number" }),
    ingestTokenLastUsedAt: bigint("ingest_token_last_used_at", { mode: "number" }),
    /** Last cumulative energy register value seen (meters that report a kWh counter). */
    lastCounterKwh: doublePrecision("last_counter_kwh"),
    lastCounterTs: bigint("last_counter_ts", { mode: "number" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("meters_ingest_token_uq").on(t.ingestTokenHash)],
);

export const PROVENANCE = ["SIMULATED", "MEASURED", "MANUAL", "IMPORTED_UNVERIFIED"] as const;

export const importBatches = pgTable("import_batches", {
  id: id(),
  factoryId: text("factory_id")
    .notNull()
    .references(() => factories.id, { onDelete: "cascade" }),
  meterId: text("meter_id")
    .notNull()
    .references(() => meters.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  provenance: text("provenance", { enum: PROVENANCE }).notNull(),
  rowsTotal: bigint("rows_total", { mode: "number" }).notNull(),
  rowsAccepted: bigint("rows_accepted", { mode: "number" }).notNull(),
  rowsRejected: bigint("rows_rejected", { mode: "number" }).notNull(),
  rowsDuplicate: bigint("rows_duplicate", { mode: "number" }).notNull(),
  issues: jsonb("issues").$type<{ row: number; message: string }[]>().notNull().default([]),
  createdBy: text("created_by").references(() => users.id),
  createdAt: createdAt(),
});

export const meterReadings = pgTable(
  "meter_readings",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    factoryId: text("factory_id")
      .notNull()
      .references(() => factories.id, { onDelete: "cascade" }),
    meterId: text("meter_id")
      .notNull()
      .references(() => meters.id, { onDelete: "cascade" }),
    ts: bigint("ts", { mode: "number" }).notNull(),
    powerKw: doublePrecision("power_kw").notNull(),
    energyKwh: doublePrecision("energy_kwh").notNull(),
    quality: text("quality", { enum: ["OK", "SUSPECT", "INVALID"] }).notNull().default("OK"),
    qualityNote: text("quality_note"),
    provenance: text("provenance", { enum: PROVENANCE }).notNull(),
    importBatchId: text("import_batch_id"),
  },
  (t) => [uniqueIndex("readings_meter_ts_uq").on(t.meterId, t.ts), index("readings_factory_ts_idx").on(t.factoryId, t.ts)],
);

export const productionPlans = pgTable(
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
    deadlineMin: bigint("deadline_min", { mode: "number" }).notNull(),
    currentPracticeStartMin: bigint("current_practice_start_min", { mode: "number" }).notNull().default(360),
    downtime: jsonb("downtime").$type<{ fromMin: number; toMin: number; reason: string }[]>().notNull().default([]),
    notes: text("notes").notNull().default(""),
    provenance: text("provenance", { enum: PROVENANCE }).notNull(),
    revision: bigint("revision", { mode: "number" }).notNull().default(1),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("plans_factory_date_uq").on(t.factoryId, t.furnaceId, t.planDate)],
);

export const productionOrders = pgTable(
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
    requiredTonnes: doublePrecision("required_tonnes").notNull(),
    dueMin: bigint("due_min", { mode: "number" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("orders_plan_code_uq").on(t.planId, t.code)],
);

/** Planned heats for a plan (inputs to the optimiser). */
export const plannedHeats = pgTable(
  "planned_heats",
  {
    id: id(),
    factoryId: text("factory_id")
      .notNull()
      .references(() => factories.id, { onDelete: "cascade" }),
    planId: text("plan_id")
      .notNull()
      .references(() => productionPlans.id, { onDelete: "cascade" }),
    sequence: bigint("sequence", { mode: "number" }).notNull(),
    heatNo: text("heat_no").notNull(),
    orderId: text("order_id").references(() => productionOrders.id),
    chargeKg: doublePrecision("charge_kg").notNull(),
    pouredKg: doublePrecision("poured_kg").notNull(),
    mouldSet: bigint("mould_set", { mode: "number" }),
  },
  (t) => [uniqueIndex("planned_heats_plan_seq_uq").on(t.planId, t.sequence)],
);

/** Mould-readiness events: planned (for a plan) or recorded (for a day that ran). */
export const mouldEvents = pgTable(
  "mould_events",
  {
    id: id(),
    factoryId: text("factory_id")
      .notNull()
      .references(() => factories.id, { onDelete: "cascade" }),
    dayDate: text("day_date").notNull(),
    kind: text("kind", { enum: ["PLANNED", "RECORDED"] }).notNull(),
    mouldSet: bigint("mould_set", { mode: "number" }).notNull(),
    readyAt: bigint("ready_at", { mode: "number" }).notNull(),
    provenance: text("provenance", { enum: PROVENANCE }).notNull(),
    note: text("note").notNull().default(""),
  },
  (t) => [uniqueIndex("mould_factory_day_kind_set_uq").on(t.factoryId, t.dayDate, t.kind, t.mouldSet)],
);

export const scheduleVersions = pgTable(
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
    version: bigint("version", { mode: "number" }).notNull(),
    totals: jsonb("totals").$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("schedule_versions_plan_idx").on(t.planId)],
);

export const scheduleItems = pgTable("schedule_items", {
  id: id(),
  scheduleVersionId: text("schedule_version_id")
    .notNull()
    .references(() => scheduleVersions.id, { onDelete: "cascade" }),
  sequence: bigint("sequence", { mode: "number" }).notNull(),
  heatNo: text("heat_no").notNull(),
  orderId: text("order_id"),
  mouldSet: bigint("mould_set", { mode: "number" }),
  mouldReadyMin: bigint("mould_ready_min", { mode: "number" }),
  startMin: bigint("start_min", { mode: "number" }).notNull(),
  meltEndMin: bigint("melt_end_min", { mode: "number" }).notNull(),
  tapMin: bigint("tap_min", { mode: "number" }).notNull(),
  holdMin: bigint("hold_min", { mode: "number" }).notNull(),
  cold: boolean("cold").notNull(),
  meltKwh: doublePrecision("melt_kwh").notNull(),
  holdKwh: doublePrecision("hold_kwh").notNull(),
  costPaise: doublePrecision("cost_paise").notNull(),
  chargeKg: doublePrecision("charge_kg").notNull(),
  pouredKg: doublePrecision("poured_kg").notNull(),
});

/** Heats that actually ran (as-run log). */
export const heats = pgTable(
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
    chargeKg: doublePrecision("charge_kg").notNull(),
    pouredKg: doublePrecision("poured_kg"),
    startAt: bigint("start_at", { mode: "number" }).notNull(),
    meltEndAt: bigint("melt_end_at", { mode: "number" }),
    tapAt: bigint("tap_at", { mode: "number" }),
    mouldSet: bigint("mould_set", { mode: "number" }),
    mouldReadyAt: bigint("mould_ready_at", { mode: "number" }),
    coldStart: boolean("cold_start").notNull().default(false),
    meterKwh: doublePrecision("meter_kwh"),
    manualKwh: doublePrecision("manual_kwh"),
    expectedKwh: doublePrecision("expected_kwh"),
    holdingMinutes: doublePrecision("holding_minutes"),
    holdingKwh: doublePrecision("holding_kwh"),
    readingCompleteness: doublePrecision("reading_completeness"),
    dataQuality: text("data_quality", { enum: ["COMPLETE", "PARTIAL", "NO_METER_DATA", "OPEN", "NOT_ANALYSED"] })
      .notNull()
      .default("NOT_ANALYSED"),
    operatorNotes: text("operator_notes").notNull().default(""),
    provenance: text("provenance", { enum: PROVENANCE }).notNull(),
    executionId: text("execution_id"),
    createdBy: text("created_by"),
    updatedBy: text("updated_by"),
    revision: bigint("revision", { mode: "number" }).notNull().default(1),
    createdAt: createdAt(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [
    uniqueIndex("heats_factory_day_no_uq").on(t.factoryId, t.dayDate, t.heatNo),
    index("heats_factory_start_idx").on(t.factoryId, t.startAt),
  ],
);

export const tariffVersions = pgTable(
  "tariff_versions",
  {
    id: id(),
    factoryId: text("factory_id")
      .notNull()
      .references(() => factories.id, { onDelete: "cascade" }),
    version: bigint("version", { mode: "number" }).notNull(),
    name: text("name").notNull(),
    effectiveFrom: bigint("effective_from", { mode: "number" }).notNull(),
    timeZone: text("time_zone").notNull(),
    normalRatePaise: bigint("normal_rate_paise", { mode: "number" }).notNull(),
    evidence: text("evidence", { enum: ["ASSUMPTION", "VERIFIED"] }).notNull().default("ASSUMPTION"),
    sourceNote: text("source_note").notNull().default(""),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("tariff_factory_version_uq").on(t.factoryId, t.version)],
);

export const tariffPeriods = pgTable("tariff_periods", {
    id: id(),
    tariffVersionId: text("tariff_version_id")
      .notNull()
      .references(() => tariffVersions.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["PEAK", "SOLAR", "OFFPEAK"] }).notNull(),
    label: text("label").notNull(),
    startMin: bigint("start_min", { mode: "number" }).notNull(),
    endMin: bigint("end_min", { mode: "number" }).notNull(),
    ratePaise: bigint("rate_paise", { mode: "number" }).notNull(),
  },
  (t) => [index("tariff_periods_version_idx").on(t.tariffVersionId)],
);

export const modelFits = pgTable("model_fits", {
    id: id(),
    factoryId: text("factory_id")
      .notNull()
      .references(() => factories.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    kind: text("kind").notNull(),
    coefficients: jsonb("coefficients").$type<Record<string, number>>().notNull(),
    n: bigint("n", { mode: "number" }).notNull(),
    r2: doublePrecision("r2"),
    rmseKwh: doublePrecision("rmse_kwh"),
    note: text("note").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("model_fits_factory_time_idx").on(t.factoryId, t.createdAt)],
);

export const anomalies = pgTable(
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
    expectedKwh: doublePrecision("expected_kwh").notNull(),
    actualKwh: doublePrecision("actual_kwh"),
    varianceKwh: doublePrecision("variance_kwh"),
    variancePct: doublePrecision("variance_pct"),
    thresholdKwh: doublePrecision("threshold_kwh").notNull(),
    severity: text("severity", { enum: ["HIGH", "MEDIUM", "LOW"] }),
    evidenceLevel: text("evidence_level", { enum: ["CONFIRMED", "STRONG", "HYPOTHESIS", "INSUFFICIENT"] }).notNull(),
    explanation: text("explanation").notNull(),
    findings: jsonb("findings").$type<unknown[]>().notNull(),
    investigation: jsonb("investigation").$type<string[]>().notNull(),
    status: text("status", { enum: ["OPEN", "ACKNOWLEDGED", "RESOLVED"] }).notNull().default("OPEN"),
    provenance: text("provenance", { enum: PROVENANCE }).notNull(),
    detectedAt: bigint("detected_at", { mode: "number" }).notNull(),
  },
  (t) => [uniqueIndex("anomalies_heat_rule_uq").on(t.heatId, t.rule), index("anomalies_factory_idx").on(t.factoryId)],
);

export const optimizationRuns = pgTable(
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
    inputSnapshot: jsonb("input_snapshot").$type<Record<string, unknown>>().notNull(),
    result: jsonb("result").$type<Record<string, unknown>>().notNull(),
    runtimeMs: doublePrecision("runtime_ms").notNull(),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => [index("runs_plan_idx").on(t.planId)],
);

export const recommendations = pgTable(
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
    version: bigint("version", { mode: "number" }).notNull(),
    status: text("status", { enum: ["PENDING", "APPROVED", "REJECTED", "STALE", "SUPERSEDED"] }).notNull(),
    inputHash: text("input_hash").notNull(),
    inputTimestamp: bigint("input_timestamp", { mode: "number" }).notNull(),
    predicted: jsonb("predicted").$type<Record<string, unknown>>().notNull(),
    summary: text("summary").notNull(),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("recs_plan_version_uq").on(t.planId, t.version), index("recs_factory_status_idx").on(t.factoryId, t.status)],
);

export const approvals = pgTable(
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
    recommendationVersion: bigint("recommendation_version", { mode: "number" }).notNull(),
    inputHash: text("input_hash").notNull(),
    decidedAt: bigint("decided_at", { mode: "number" }).notNull(),
  },
  // One decision per recommendation: the database rejects a second one.
  (t) => [uniqueIndex("approvals_recommendation_uq").on(t.recommendationId)],
);

export const executionRecords = pgTable("execution_records", {
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
    summary: jsonb("summary").$type<Record<string, unknown>>().notNull(),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => [index("executions_factory_day_idx").on(t.factoryId, t.dayDate)],
);

export const verificationReports = pgTable("verification_reports", {
  id: id(),
  factoryId: text("factory_id")
    .notNull()
    .references(() => factories.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  baselineDay: text("baseline_day").notNull(),
  comparisonDay: text("comparison_day").notNull(),
  executionId: text("execution_id"),
  evidenceLabel: text("evidence_label").notNull(),
  metrics: jsonb("metrics").$type<Record<string, unknown>>().notNull(),
  assumptions: jsonb("assumptions").$type<Record<string, unknown>>().notNull(),
  createdBy: text("created_by"),
  createdAt: createdAt(),
});

export const auditEvents = pgTable(
  "audit_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    factoryId: text("factory_id"),
    actorId: text("actor_id"),
    actorName: text("actor_name"),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    /** Hash chain (per factory): hash = SHA-256(prevHash + canonical event). Set by the sealer. */
    prevHash: text("prev_hash"),
    hash: text("hash"),
    /** Position in the chain, assigned by the sealer under a lock (ids can commit out of order in Postgres). */
    sealSeq: bigint("seal_seq", { mode: "number" }),
  },
  (t) => [index("audit_factory_time_idx").on(t.factoryId, t.createdAt), index("audit_factory_seal_idx").on(t.factoryId, t.sealSeq)],
);

export const simulationScenarios = pgTable("simulation_scenarios", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  summary: text("summary").notNull(),
  purpose: text("purpose").notNull(),
  seed: bigint("seed", { mode: "number" }).notNull(),
  config: jsonb("config").$type<Record<string, unknown>>().notNull(),
});

/** A stated baseline for one factory: the reference period savings are measured against. */
export const energyBaselines = pgTable("energy_baselines", {
  id: id(),
  factoryId: text("factory_id")
    .notNull()
    .references(() => factories.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  method: text("method").notNull(),
  periodStartDay: text("period_start_day").notNull(),
  periodEndDay: text("period_end_day").notNull(),
  energyKwh: doublePrecision("energy_kwh").notNull(),
  tonnesPoured: doublePrecision("tonnes_poured").notNull(),
  costPaise: doublePrecision("cost_paise").notNull(),
  holdingMinutes: doublePrecision("holding_minutes").notNull(),
  completeness: doublePrecision("completeness"),
  evidenceLabel: text("evidence_label").notNull(),
  createdBy: text("created_by"),
  createdAt: createdAt(),
});

export const ALERT_KINDS = ["ANOMALY_HIGH", "APPROVAL_PENDING", "ADVICE_PAUSED", "METER_OFFLINE", "SEC_DRIFT", "TEST"] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

/** Alerts raised by the system. `dedupeKey` makes raising the same alert twice a no-op. */
export const alerts = pgTable(
  "alerts",
  {
    id: id(),
    factoryId: text("factory_id")
      .notNull()
      .references(() => factories.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ALERT_KINDS }).notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    href: text("href"),
    deliveredAt: bigint("delivered_at", { mode: "number" }),
    deliveryError: text("delivery_error"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("alerts_factory_key_uq").on(t.factoryId, t.dedupeKey), index("alerts_factory_time_idx").on(t.factoryId, t.createdAt)],
);

/**
 * Public power-market prices (shared by every factory; not tenant data).
 * One row per source, delivery date and 15-minute block. Refreshed by a server job.
 */
export const marketPrices = pgTable(
  "market_prices",
  {
    source: text("source").notNull(),
    deliveryDate: text("delivery_date").notNull(),
    block: bigint("block", { mode: "number" }).notNull(),
    startMin: bigint("start_min", { mode: "number" }).notNull(),
    mcpRsPerMwh: doublePrecision("mcp_rs_per_mwh").notNull(),
    mcvMw: doublePrecision("mcv_mw").notNull(),
    purchaseBidMw: doublePrecision("purchase_bid_mw").notNull(),
    sellBidMw: doublePrecision("sell_bid_mw").notNull(),
    fetchedAt: bigint("fetched_at", { mode: "number" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.source, t.deliveryDate, t.block] })],
);

/**
 * Read-only integration keys (ERP, MES, BI tools). Scoped to one factory; only the
 * SHA-256 of the key is stored. Shown once at creation.
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: id(),
    factoryId: text("factory_id")
      .notNull()
      .references(() => factories.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    /** First characters of the key, to recognise it in the list. */
    prefix: text("prefix").notNull(),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    lastUsedAt: bigint("last_used_at", { mode: "number" }),
    revokedAt: bigint("revoked_at", { mode: "number" }),
  },
  (t) => [index("api_keys_factory_idx").on(t.factoryId)],
);

/** Fixed-window counters shared by every server instance (login failures, API calls). */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  n: bigint("n", { mode: "number" }).notNull(),
  resetAt: bigint("reset_at", { mode: "number" }).notNull(),
});
