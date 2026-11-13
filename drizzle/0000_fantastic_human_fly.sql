CREATE TABLE "alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"factory_id" text NOT NULL,
	"kind" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"href" text,
	"delivered_at" bigint,
	"delivery_error" text,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "anomalies" (
	"id" text PRIMARY KEY NOT NULL,
	"factory_id" text NOT NULL,
	"heat_id" text NOT NULL,
	"model_fit_id" text,
	"rule" text NOT NULL,
	"model_version" text NOT NULL,
	"expected_kwh" double precision NOT NULL,
	"actual_kwh" double precision,
	"variance_kwh" double precision,
	"variance_pct" double precision,
	"threshold_kwh" double precision NOT NULL,
	"severity" text,
	"evidence_level" text NOT NULL,
	"explanation" text NOT NULL,
	"findings" jsonb NOT NULL,
	"investigation" jsonb NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"provenance" text NOT NULL,
	"detected_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"factory_id" text NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"created_by" text,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"last_used_at" bigint,
	"revoked_at" bigint,
	CONSTRAINT "api_keys_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"factory_id" text NOT NULL,
	"recommendation_id" text NOT NULL,
	"decision" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"actor_id" text NOT NULL,
	"actor_role" text NOT NULL,
	"recommendation_version" bigint NOT NULL,
	"input_hash" text NOT NULL,
	"decided_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"factory_id" text,
	"actor_id" text,
	"actor_name" text,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" bigint NOT NULL,
	"prev_hash" text,
	"hash" text,
	"seal_seq" bigint
);
--> statement-breakpoint
CREATE TABLE "energy_baselines" (
	"id" text PRIMARY KEY NOT NULL,
	"factory_id" text NOT NULL,
	"label" text NOT NULL,
	"method" text NOT NULL,
	"period_start_day" text NOT NULL,
	"period_end_day" text NOT NULL,
	"energy_kwh" double precision NOT NULL,
	"tonnes_poured" double precision NOT NULL,
	"cost_paise" double precision NOT NULL,
	"holding_minutes" double precision NOT NULL,
	"completeness" double precision,
	"evidence_label" text NOT NULL,
	"created_by" text,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_records" (
	"id" text PRIMARY KEY NOT NULL,
	"factory_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"schedule_version_id" text NOT NULL,
	"recommendation_id" text,
	"day_date" text NOT NULL,
	"kind" text NOT NULL,
	"provenance" text NOT NULL,
	"summary" jsonb NOT NULL,
	"created_by" text,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "factories" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"time_zone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"is_simulation" boolean DEFAULT false NOT NULL,
	"active_scenario" text,
	"holding_kw" double precision DEFAULT 60 NOT NULL,
	"emission_factor_kg_per_kwh" double precision DEFAULT 0.727 NOT NULL,
	"emission_factor_source" text DEFAULT 'CEA CO2 Baseline Database v20.0, FY 2023-24 weighted average (as cited in deck)' NOT NULL,
	"turnaround_minutes" bigint DEFAULT 10 NOT NULL,
	"cold_gap_minutes" bigint DEFAULT 60 NOT NULL,
	"cold_extra_minutes" bigint DEFAULT 5 NOT NULL,
	"max_hold_minutes" bigint DEFAULT 60 NOT NULL,
	"min_completeness" double precision DEFAULT 0.98 NOT NULL,
	"grid_minutes" bigint DEFAULT 5 NOT NULL,
	"site_cap_kva" double precision,
	"power_factor" double precision DEFAULT 0.95 NOT NULL,
	"base_load_day_kw" double precision DEFAULT 0 NOT NULL,
	"base_load_night_kw" double precision DEFAULT 0 NOT NULL,
	"analysis_requested_at" bigint,
	"demand_rate_paise_per_kva_month" bigint,
	"alert_webhook_url" text,
	"alert_webhook_secret" text,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	CONSTRAINT "factories_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "furnaces" (
	"id" text PRIMARY KEY NOT NULL,
	"factory_id" text NOT NULL,
	"name" text NOT NULL,
	"capacity_kg" double precision NOT NULL,
	"rated_kw" double precision NOT NULL,
	"nominal_melt_minutes" bigint NOT NULL,
	"available_from_min" bigint DEFAULT 360 NOT NULL,
	"available_to_min" bigint DEFAULT 1320 NOT NULL,
	"max_heats_per_day" bigint DEFAULT 14 NOT NULL,
	"status" text DEFAULT 'AVAILABLE' NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "heats" (
	"id" text PRIMARY KEY NOT NULL,
	"factory_id" text NOT NULL,
	"furnace_id" text NOT NULL,
	"day_date" text NOT NULL,
	"heat_no" text NOT NULL,
	"grade" text DEFAULT '' NOT NULL,
	"order_code" text,
	"charge_kg" double precision NOT NULL,
	"poured_kg" double precision,
	"start_at" bigint NOT NULL,
	"melt_end_at" bigint,
	"tap_at" bigint,
	"mould_set" bigint,
	"mould_ready_at" bigint,
	"cold_start" boolean DEFAULT false NOT NULL,
	"meter_kwh" double precision,
	"manual_kwh" double precision,
	"expected_kwh" double precision,
	"holding_minutes" double precision,
	"holding_kwh" double precision,
	"reading_completeness" double precision,
	"data_quality" text DEFAULT 'NOT_ANALYSED' NOT NULL,
	"operator_notes" text DEFAULT '' NOT NULL,
	"provenance" text NOT NULL,
	"execution_id" text,
	"created_by" text,
	"updated_by" text,
	"revision" bigint DEFAULT 1 NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"factory_id" text NOT NULL,
	"meter_id" text NOT NULL,
	"filename" text NOT NULL,
	"provenance" text NOT NULL,
	"rows_total" bigint NOT NULL,
	"rows_accepted" bigint NOT NULL,
	"rows_rejected" bigint NOT NULL,
	"rows_duplicate" bigint NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_prices" (
	"source" text NOT NULL,
	"delivery_date" text NOT NULL,
	"block" bigint NOT NULL,
	"start_min" bigint NOT NULL,
	"mcp_rs_per_mwh" double precision NOT NULL,
	"mcv_mw" double precision NOT NULL,
	"purchase_bid_mw" double precision NOT NULL,
	"sell_bid_mw" double precision NOT NULL,
	"fetched_at" bigint NOT NULL,
	CONSTRAINT "market_prices_source_delivery_date_block_pk" PRIMARY KEY("source","delivery_date","block")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"factory_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meter_readings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"factory_id" text NOT NULL,
	"meter_id" text NOT NULL,
	"ts" bigint NOT NULL,
	"power_kw" double precision NOT NULL,
	"energy_kwh" double precision NOT NULL,
	"quality" text DEFAULT 'OK' NOT NULL,
	"quality_note" text,
	"provenance" text NOT NULL,
	"import_batch_id" text
);
--> statement-breakpoint
CREATE TABLE "meters" (
	"id" text PRIMARY KEY NOT NULL,
	"factory_id" text NOT NULL,
	"furnace_id" text,
	"name" text NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"interval_seconds" bigint DEFAULT 60 NOT NULL,
	"ingest_token_hash" text,
	"ingest_token_issued_at" bigint,
	"ingest_token_last_used_at" bigint,
	"last_counter_kwh" double precision,
	"last_counter_ts" bigint,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_fits" (
	"id" text PRIMARY KEY NOT NULL,
	"factory_id" text NOT NULL,
	"version" text NOT NULL,
	"kind" text NOT NULL,
	"coefficients" jsonb NOT NULL,
	"n" bigint NOT NULL,
	"r2" double precision,
	"rmse_kwh" double precision,
	"note" text NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mould_events" (
	"id" text PRIMARY KEY NOT NULL,
	"factory_id" text NOT NULL,
	"day_date" text NOT NULL,
	"kind" text NOT NULL,
	"mould_set" bigint NOT NULL,
	"ready_at" bigint NOT NULL,
	"provenance" text NOT NULL,
	"note" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "optimization_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"factory_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"status" text NOT NULL,
	"solver" text NOT NULL,
	"solver_version" text NOT NULL,
	"model_version" text NOT NULL,
	"model_fit_id" text,
	"tariff_version_id" text,
	"input_hash" text NOT NULL,
	"input_snapshot" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"runtime_ms" double precision NOT NULL,
	"created_by" text,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "planned_heats" (
	"id" text PRIMARY KEY NOT NULL,
	"factory_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"sequence" bigint NOT NULL,
	"heat_no" text NOT NULL,
	"order_id" text,
	"charge_kg" double precision NOT NULL,
	"poured_kg" double precision NOT NULL,
	"mould_set" bigint
);
--> statement-breakpoint
CREATE TABLE "production_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"factory_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"code" text NOT NULL,
	"grade" text NOT NULL,
	"required_tonnes" double precision NOT NULL,
	"due_min" bigint NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"factory_id" text NOT NULL,
	"furnace_id" text NOT NULL,
	"plan_date" text NOT NULL,
	"deadline_min" bigint NOT NULL,
	"current_practice_start_min" bigint DEFAULT 360 NOT NULL,
	"downtime" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"provenance" text NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	"updated_at" bigint NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"n" bigint NOT NULL,
	"reset_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recommendations" (
	"id" text PRIMARY KEY NOT NULL,
	"factory_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"optimization_run_id" text NOT NULL,
	"proposed_schedule_id" text NOT NULL,
	"current_schedule_id" text NOT NULL,
	"version" bigint NOT NULL,
	"status" text NOT NULL,
	"input_hash" text NOT NULL,
	"input_timestamp" bigint NOT NULL,
	"predicted" jsonb NOT NULL,
	"summary" text NOT NULL,
	"created_by" text,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_items" (
	"id" text PRIMARY KEY NOT NULL,
	"schedule_version_id" text NOT NULL,
	"sequence" bigint NOT NULL,
	"heat_no" text NOT NULL,
	"order_id" text,
	"mould_set" bigint,
	"mould_ready_min" bigint,
	"start_min" bigint NOT NULL,
	"melt_end_min" bigint NOT NULL,
	"tap_min" bigint NOT NULL,
	"hold_min" bigint NOT NULL,
	"cold" boolean NOT NULL,
	"melt_kwh" double precision NOT NULL,
	"hold_kwh" double precision NOT NULL,
	"cost_paise" double precision NOT NULL,
	"charge_kg" double precision NOT NULL,
	"poured_kg" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"factory_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"optimization_run_id" text,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"version" bigint NOT NULL,
	"totals" jsonb NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"active_factory_id" text,
	"expires_at" bigint NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "simulation_scenarios" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"summary" text NOT NULL,
	"purpose" text NOT NULL,
	"seed" bigint NOT NULL,
	"config" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tariff_periods" (
	"id" text PRIMARY KEY NOT NULL,
	"tariff_version_id" text NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"start_min" bigint NOT NULL,
	"end_min" bigint NOT NULL,
	"rate_paise" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tariff_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"factory_id" text NOT NULL,
	"version" bigint NOT NULL,
	"name" text NOT NULL,
	"effective_from" bigint NOT NULL,
	"time_zone" text NOT NULL,
	"normal_rate_paise" bigint NOT NULL,
	"evidence" text DEFAULT 'ASSUMPTION' NOT NULL,
	"source_note" text DEFAULT '' NOT NULL,
	"created_by" text,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"disabled" boolean DEFAULT false NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"password_changed_at" bigint,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"factory_id" text NOT NULL,
	"title" text NOT NULL,
	"baseline_day" text NOT NULL,
	"comparison_day" text NOT NULL,
	"execution_id" text,
	"evidence_label" text NOT NULL,
	"metrics" jsonb NOT NULL,
	"assumptions" jsonb NOT NULL,
	"created_by" text,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_factory_id_factories_id_fk" FOREIGN KEY ("factory_id") REFERENCES "public"."factories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anomalies" ADD CONSTRAINT "anomalies_factory_id_factories_id_fk" FOREIGN KEY ("factory_id") REFERENCES "public"."factories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anomalies" ADD CONSTRAINT "anomalies_heat_id_heats_id_fk" FOREIGN KEY ("heat_id") REFERENCES "public"."heats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_factory_id_factories_id_fk" FOREIGN KEY ("factory_id") REFERENCES "public"."factories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_factory_id_factories_id_fk" FOREIGN KEY ("factory_id") REFERENCES "public"."factories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_recommendation_id_recommendations_id_fk" FOREIGN KEY ("recommendation_id") REFERENCES "public"."recommendations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "energy_baselines" ADD CONSTRAINT "energy_baselines_factory_id_factories_id_fk" FOREIGN KEY ("factory_id") REFERENCES "public"."factories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_records" ADD CONSTRAINT "execution_records_factory_id_factories_id_fk" FOREIGN KEY ("factory_id") REFERENCES "public"."factories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_records" ADD CONSTRAINT "execution_records_plan_id_production_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."production_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_records" ADD CONSTRAINT "execution_records_schedule_version_id_schedule_versions_id_fk" FOREIGN KEY ("schedule_version_id") REFERENCES "public"."schedule_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factories" ADD CONSTRAINT "factories_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "furnaces" ADD CONSTRAINT "furnaces_factory_id_factories_id_fk" FOREIGN KEY ("factory_id") REFERENCES "public"."factories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heats" ADD CONSTRAINT "heats_factory_id_factories_id_fk" FOREIGN KEY ("factory_id") REFERENCES "public"."factories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heats" ADD CONSTRAINT "heats_furnace_id_furnaces_id_fk" FOREIGN KEY ("furnace_id") REFERENCES "public"."furnaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_factory_id_factories_id_fk" FOREIGN KEY ("factory_id") REFERENCES "public"."factories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_meter_id_meters_id_fk" FOREIGN KEY ("meter_id") REFERENCES "public"."meters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_factory_id_factories_id_fk" FOREIGN KEY ("factory_id") REFERENCES "public"."factories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_factory_id_factories_id_fk" FOREIGN KEY ("factory_id") REFERENCES "public"."factories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_meter_id_meters_id_fk" FOREIGN KEY ("meter_id") REFERENCES "public"."meters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meters" ADD CONSTRAINT "meters_factory_id_factories_id_fk" FOREIGN KEY ("factory_id") REFERENCES "public"."factories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meters" ADD CONSTRAINT "meters_furnace_id_furnaces_id_fk" FOREIGN KEY ("furnace_id") REFERENCES "public"."furnaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_fits" ADD CONSTRAINT "model_fits_factory_id_factories_id_fk" FOREIGN KEY ("factory_id") REFERENCES "public"."factories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mould_events" ADD CONSTRAINT "mould_events_factory_id_factories_id_fk" FOREIGN KEY ("factory_id") REFERENCES "public"."factories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "optimization_runs" ADD CONSTRAINT "optimization_runs_factory_id_factories_id_fk" FOREIGN KEY ("factory_id") REFERENCES "public"."factories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "optimization_runs" ADD CONSTRAINT "optimization_runs_plan_id_production_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."production_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_heats" ADD CONSTRAINT "planned_heats_factory_id_factories_id_fk" FOREIGN KEY ("factory_id") REFERENCES "public"."factories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_heats" ADD CONSTRAINT "planned_heats_plan_id_production_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."production_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_heats" ADD CONSTRAINT "planned_heats_order_id_production_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."production_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_factory_id_factories_id_fk" FOREIGN KEY ("factory_id") REFERENCES "public"."factories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_plan_id_production_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."production_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_plans" ADD CONSTRAINT "production_plans_factory_id_factories_id_fk" FOREIGN KEY ("factory_id") REFERENCES "public"."factories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_plans" ADD CONSTRAINT "production_plans_furnace_id_furnaces_id_fk" FOREIGN KEY ("furnace_id") REFERENCES "public"."furnaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_factory_id_factories_id_fk" FOREIGN KEY ("factory_id") REFERENCES "public"."factories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_plan_id_production_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."production_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_optimization_run_id_optimization_runs_id_fk" FOREIGN KEY ("optimization_run_id") REFERENCES "public"."optimization_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_proposed_schedule_id_schedule_versions_id_fk" FOREIGN KEY ("proposed_schedule_id") REFERENCES "public"."schedule_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_current_schedule_id_schedule_versions_id_fk" FOREIGN KEY ("current_schedule_id") REFERENCES "public"."schedule_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_items" ADD CONSTRAINT "schedule_items_schedule_version_id_schedule_versions_id_fk" FOREIGN KEY ("schedule_version_id") REFERENCES "public"."schedule_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_versions" ADD CONSTRAINT "schedule_versions_factory_id_factories_id_fk" FOREIGN KEY ("factory_id") REFERENCES "public"."factories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_versions" ADD CONSTRAINT "schedule_versions_plan_id_production_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."production_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tariff_periods" ADD CONSTRAINT "tariff_periods_tariff_version_id_tariff_versions_id_fk" FOREIGN KEY ("tariff_version_id") REFERENCES "public"."tariff_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tariff_versions" ADD CONSTRAINT "tariff_versions_factory_id_factories_id_fk" FOREIGN KEY ("factory_id") REFERENCES "public"."factories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_reports" ADD CONSTRAINT "verification_reports_factory_id_factories_id_fk" FOREIGN KEY ("factory_id") REFERENCES "public"."factories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alerts_factory_key_uq" ON "alerts" USING btree ("factory_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "alerts_factory_time_idx" ON "alerts" USING btree ("factory_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "anomalies_heat_rule_uq" ON "anomalies" USING btree ("heat_id","rule");--> statement-breakpoint
CREATE INDEX "anomalies_factory_idx" ON "anomalies" USING btree ("factory_id");--> statement-breakpoint
CREATE INDEX "api_keys_factory_idx" ON "api_keys" USING btree ("factory_id");--> statement-breakpoint
CREATE UNIQUE INDEX "approvals_recommendation_uq" ON "approvals" USING btree ("recommendation_id");--> statement-breakpoint
CREATE INDEX "audit_factory_time_idx" ON "audit_events" USING btree ("factory_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_factory_seal_idx" ON "audit_events" USING btree ("factory_id","seal_seq");--> statement-breakpoint
CREATE INDEX "executions_factory_day_idx" ON "execution_records" USING btree ("factory_id","day_date");--> statement-breakpoint
CREATE UNIQUE INDEX "heats_factory_day_no_uq" ON "heats" USING btree ("factory_id","day_date","heat_no");--> statement-breakpoint
CREATE INDEX "heats_factory_start_idx" ON "heats" USING btree ("factory_id","start_at");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_user_factory_uq" ON "memberships" USING btree ("user_id","factory_id");--> statement-breakpoint
CREATE UNIQUE INDEX "readings_meter_ts_uq" ON "meter_readings" USING btree ("meter_id","ts");--> statement-breakpoint
CREATE INDEX "readings_factory_ts_idx" ON "meter_readings" USING btree ("factory_id","ts");--> statement-breakpoint
CREATE UNIQUE INDEX "meters_ingest_token_uq" ON "meters" USING btree ("ingest_token_hash");--> statement-breakpoint
CREATE INDEX "model_fits_factory_time_idx" ON "model_fits" USING btree ("factory_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mould_factory_day_kind_set_uq" ON "mould_events" USING btree ("factory_id","day_date","kind","mould_set");--> statement-breakpoint
CREATE INDEX "runs_plan_idx" ON "optimization_runs" USING btree ("plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "planned_heats_plan_seq_uq" ON "planned_heats" USING btree ("plan_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_plan_code_uq" ON "production_orders" USING btree ("plan_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_factory_date_uq" ON "production_plans" USING btree ("factory_id","furnace_id","plan_date");--> statement-breakpoint
CREATE UNIQUE INDEX "recs_plan_version_uq" ON "recommendations" USING btree ("plan_id","version");--> statement-breakpoint
CREATE INDEX "recs_factory_status_idx" ON "recommendations" USING btree ("factory_id","status");--> statement-breakpoint
CREATE INDEX "schedule_versions_plan_idx" ON "schedule_versions" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tariff_periods_version_idx" ON "tariff_periods" USING btree ("tariff_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tariff_factory_version_uq" ON "tariff_versions" USING btree ("factory_id","version");