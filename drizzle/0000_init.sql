CREATE TABLE `anomalies` (
	`id` text PRIMARY KEY NOT NULL,
	`factory_id` text NOT NULL,
	`heat_id` text NOT NULL,
	`model_fit_id` text,
	`rule` text NOT NULL,
	`model_version` text NOT NULL,
	`expected_kwh` real NOT NULL,
	`actual_kwh` real,
	`variance_kwh` real,
	`variance_pct` real,
	`threshold_kwh` real NOT NULL,
	`severity` text,
	`evidence_level` text NOT NULL,
	`explanation` text NOT NULL,
	`findings` text NOT NULL,
	`investigation` text NOT NULL,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`provenance` text NOT NULL,
	`detected_at` integer NOT NULL,
	FOREIGN KEY (`factory_id`) REFERENCES `factories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`heat_id`) REFERENCES `heats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `anomalies_heat_rule_uq` ON `anomalies` (`heat_id`,`rule`);--> statement-breakpoint
CREATE INDEX `anomalies_factory_idx` ON `anomalies` (`factory_id`);--> statement-breakpoint
CREATE TABLE `approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`factory_id` text NOT NULL,
	`recommendation_id` text NOT NULL,
	`decision` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`actor_id` text NOT NULL,
	`actor_role` text NOT NULL,
	`recommendation_version` integer NOT NULL,
	`input_hash` text NOT NULL,
	`decided_at` integer NOT NULL,
	FOREIGN KEY (`factory_id`) REFERENCES `factories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recommendation_id`) REFERENCES `recommendations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `approvals_recommendation_uq` ON `approvals` (`recommendation_id`);--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`factory_id` text,
	`actor_id` text,
	`actor_name` text,
	`action` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text,
	`details` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_factory_time_idx` ON `audit_events` (`factory_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `energy_baselines` (
	`id` text PRIMARY KEY NOT NULL,
	`factory_id` text NOT NULL,
	`label` text NOT NULL,
	`method` text NOT NULL,
	`period_start_day` text NOT NULL,
	`period_end_day` text NOT NULL,
	`energy_kwh` real NOT NULL,
	`tonnes_poured` real NOT NULL,
	`cost_paise` real NOT NULL,
	`holding_minutes` real NOT NULL,
	`completeness` real,
	`evidence_label` text NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`factory_id`) REFERENCES `factories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `execution_records` (
	`id` text PRIMARY KEY NOT NULL,
	`factory_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`schedule_version_id` text NOT NULL,
	`recommendation_id` text,
	`day_date` text NOT NULL,
	`kind` text NOT NULL,
	`provenance` text NOT NULL,
	`summary` text NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`factory_id`) REFERENCES `factories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plan_id`) REFERENCES `production_plans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`schedule_version_id`) REFERENCES `schedule_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `factories` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`name` text NOT NULL,
	`code` text NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`time_zone` text DEFAULT 'Asia/Kolkata' NOT NULL,
	`is_simulation` integer DEFAULT false NOT NULL,
	`active_scenario` text,
	`holding_kw` real DEFAULT 60 NOT NULL,
	`emission_factor_kg_per_kwh` real DEFAULT 0.727 NOT NULL,
	`emission_factor_source` text DEFAULT 'CEA CO2 Baseline Database v20.0, FY 2023-24 weighted average (as cited in deck)' NOT NULL,
	`turnaround_minutes` integer DEFAULT 10 NOT NULL,
	`cold_gap_minutes` integer DEFAULT 60 NOT NULL,
	`cold_extra_minutes` integer DEFAULT 5 NOT NULL,
	`max_hold_minutes` integer DEFAULT 60 NOT NULL,
	`min_completeness` real DEFAULT 0.98 NOT NULL,
	`grid_minutes` integer DEFAULT 5 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `factories_code_unique` ON `factories` (`code`);--> statement-breakpoint
CREATE TABLE `furnaces` (
	`id` text PRIMARY KEY NOT NULL,
	`factory_id` text NOT NULL,
	`name` text NOT NULL,
	`capacity_kg` real NOT NULL,
	`rated_kw` real NOT NULL,
	`nominal_melt_minutes` integer NOT NULL,
	`available_from_min` integer DEFAULT 360 NOT NULL,
	`available_to_min` integer DEFAULT 1320 NOT NULL,
	`max_heats_per_day` integer DEFAULT 14 NOT NULL,
	`status` text DEFAULT 'AVAILABLE' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`factory_id`) REFERENCES `factories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `heats` (
	`id` text PRIMARY KEY NOT NULL,
	`factory_id` text NOT NULL,
	`furnace_id` text NOT NULL,
	`day_date` text NOT NULL,
	`heat_no` text NOT NULL,
	`grade` text DEFAULT '' NOT NULL,
	`order_code` text,
	`charge_kg` real NOT NULL,
	`poured_kg` real,
	`start_at` integer NOT NULL,
	`melt_end_at` integer,
	`tap_at` integer,
	`mould_set` integer,
	`mould_ready_at` integer,
	`cold_start` integer DEFAULT false NOT NULL,
	`meter_kwh` real,
	`manual_kwh` real,
	`expected_kwh` real,
	`holding_minutes` real,
	`holding_kwh` real,
	`reading_completeness` real,
	`data_quality` text DEFAULT 'NOT_ANALYSED' NOT NULL,
	`operator_notes` text DEFAULT '' NOT NULL,
	`provenance` text NOT NULL,
	`execution_id` text,
	`created_by` text,
	`updated_by` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`factory_id`) REFERENCES `factories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`furnace_id`) REFERENCES `furnaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `heats_factory_day_no_uq` ON `heats` (`factory_id`,`day_date`,`heat_no`);--> statement-breakpoint
CREATE INDEX `heats_factory_start_idx` ON `heats` (`factory_id`,`start_at`);--> statement-breakpoint
CREATE TABLE `import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`factory_id` text NOT NULL,
	`meter_id` text NOT NULL,
	`filename` text NOT NULL,
	`provenance` text NOT NULL,
	`rows_total` integer NOT NULL,
	`rows_accepted` integer NOT NULL,
	`rows_rejected` integer NOT NULL,
	`rows_duplicate` integer NOT NULL,
	`issues` text DEFAULT '[]' NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`factory_id`) REFERENCES `factories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`meter_id`) REFERENCES `meters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`factory_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`factory_id`) REFERENCES `factories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memberships_user_factory_uq` ON `memberships` (`user_id`,`factory_id`);--> statement-breakpoint
CREATE TABLE `meter_readings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`factory_id` text NOT NULL,
	`meter_id` text NOT NULL,
	`ts` integer NOT NULL,
	`power_kw` real NOT NULL,
	`energy_kwh` real NOT NULL,
	`quality` text DEFAULT 'OK' NOT NULL,
	`quality_note` text,
	`provenance` text NOT NULL,
	`import_batch_id` text,
	FOREIGN KEY (`factory_id`) REFERENCES `factories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`meter_id`) REFERENCES `meters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `readings_meter_ts_uq` ON `meter_readings` (`meter_id`,`ts`);--> statement-breakpoint
CREATE INDEX `readings_factory_ts_idx` ON `meter_readings` (`factory_id`,`ts`);--> statement-breakpoint
CREATE TABLE `meters` (
	`id` text PRIMARY KEY NOT NULL,
	`factory_id` text NOT NULL,
	`furnace_id` text,
	`name` text NOT NULL,
	`model` text DEFAULT '' NOT NULL,
	`interval_seconds` integer DEFAULT 60 NOT NULL,
	`ingest_token_hash` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`factory_id`) REFERENCES `factories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`furnace_id`) REFERENCES `furnaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `model_fits` (
	`id` text PRIMARY KEY NOT NULL,
	`factory_id` text NOT NULL,
	`version` text NOT NULL,
	`kind` text NOT NULL,
	`coefficients` text NOT NULL,
	`n` integer NOT NULL,
	`r2` real,
	`rmse_kwh` real,
	`note` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`factory_id`) REFERENCES `factories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `mould_events` (
	`id` text PRIMARY KEY NOT NULL,
	`factory_id` text NOT NULL,
	`day_date` text NOT NULL,
	`kind` text NOT NULL,
	`mould_set` integer NOT NULL,
	`ready_at` integer NOT NULL,
	`provenance` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`factory_id`) REFERENCES `factories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mould_factory_day_kind_set_uq` ON `mould_events` (`factory_id`,`day_date`,`kind`,`mould_set`);--> statement-breakpoint
CREATE TABLE `optimization_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`factory_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`status` text NOT NULL,
	`solver` text NOT NULL,
	`solver_version` text NOT NULL,
	`model_version` text NOT NULL,
	`model_fit_id` text,
	`tariff_version_id` text,
	`input_hash` text NOT NULL,
	`input_snapshot` text NOT NULL,
	`result` text NOT NULL,
	`runtime_ms` real NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`factory_id`) REFERENCES `factories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plan_id`) REFERENCES `production_plans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `runs_plan_idx` ON `optimization_runs` (`plan_id`);--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `planned_heats` (
	`id` text PRIMARY KEY NOT NULL,
	`factory_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`heat_no` text NOT NULL,
	`order_id` text,
	`charge_kg` real NOT NULL,
	`poured_kg` real NOT NULL,
	`mould_set` integer,
	FOREIGN KEY (`factory_id`) REFERENCES `factories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plan_id`) REFERENCES `production_plans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`order_id`) REFERENCES `production_orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `planned_heats_plan_seq_uq` ON `planned_heats` (`plan_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `production_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`factory_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`code` text NOT NULL,
	`grade` text NOT NULL,
	`required_tonnes` real NOT NULL,
	`due_min` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`factory_id`) REFERENCES `factories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plan_id`) REFERENCES `production_plans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_plan_code_uq` ON `production_orders` (`plan_id`,`code`);--> statement-breakpoint
CREATE TABLE `production_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`factory_id` text NOT NULL,
	`furnace_id` text NOT NULL,
	`plan_date` text NOT NULL,
	`deadline_min` integer NOT NULL,
	`current_practice_start_min` integer DEFAULT 360 NOT NULL,
	`downtime` text DEFAULT '[]' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`provenance` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`factory_id`) REFERENCES `factories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`furnace_id`) REFERENCES `furnaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plans_factory_date_uq` ON `production_plans` (`factory_id`,`furnace_id`,`plan_date`);--> statement-breakpoint
CREATE TABLE `recommendations` (
	`id` text PRIMARY KEY NOT NULL,
	`factory_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`optimization_run_id` text NOT NULL,
	`proposed_schedule_id` text NOT NULL,
	`current_schedule_id` text NOT NULL,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	`input_hash` text NOT NULL,
	`input_timestamp` integer NOT NULL,
	`predicted` text NOT NULL,
	`summary` text NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`factory_id`) REFERENCES `factories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plan_id`) REFERENCES `production_plans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`optimization_run_id`) REFERENCES `optimization_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`proposed_schedule_id`) REFERENCES `schedule_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`current_schedule_id`) REFERENCES `schedule_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recs_plan_version_uq` ON `recommendations` (`plan_id`,`version`);--> statement-breakpoint
CREATE INDEX `recs_factory_status_idx` ON `recommendations` (`factory_id`,`status`);--> statement-breakpoint
CREATE TABLE `schedule_items` (
	`id` text PRIMARY KEY NOT NULL,
	`schedule_version_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`heat_no` text NOT NULL,
	`order_id` text,
	`mould_set` integer,
	`mould_ready_min` integer,
	`start_min` integer NOT NULL,
	`melt_end_min` integer NOT NULL,
	`tap_min` integer NOT NULL,
	`hold_min` integer NOT NULL,
	`cold` integer NOT NULL,
	`melt_kwh` real NOT NULL,
	`hold_kwh` real NOT NULL,
	`cost_paise` real NOT NULL,
	`charge_kg` real NOT NULL,
	`poured_kg` real NOT NULL,
	FOREIGN KEY (`schedule_version_id`) REFERENCES `schedule_versions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `schedule_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`factory_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`optimization_run_id` text,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`version` integer NOT NULL,
	`totals` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`factory_id`) REFERENCES `factories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plan_id`) REFERENCES `production_plans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `schedule_versions_plan_idx` ON `schedule_versions` (`plan_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`active_factory_id` text,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `simulation_scenarios` (
	`key` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`summary` text NOT NULL,
	`purpose` text NOT NULL,
	`seed` integer NOT NULL,
	`config` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tariff_periods` (
	`id` text PRIMARY KEY NOT NULL,
	`tariff_version_id` text NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`start_min` integer NOT NULL,
	`end_min` integer NOT NULL,
	`rate_paise` integer NOT NULL,
	FOREIGN KEY (`tariff_version_id`) REFERENCES `tariff_versions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tariff_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`factory_id` text NOT NULL,
	`version` integer NOT NULL,
	`name` text NOT NULL,
	`effective_from` integer NOT NULL,
	`time_zone` text NOT NULL,
	`normal_rate_paise` integer NOT NULL,
	`evidence` text DEFAULT 'ASSUMPTION' NOT NULL,
	`source_note` text DEFAULT '' NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`factory_id`) REFERENCES `factories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tariff_factory_version_uq` ON `tariff_versions` (`factory_id`,`version`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `verification_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`factory_id` text NOT NULL,
	`title` text NOT NULL,
	`baseline_day` text NOT NULL,
	`comparison_day` text NOT NULL,
	`execution_id` text,
	`evidence_label` text NOT NULL,
	`metrics` text NOT NULL,
	`assumptions` text NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`factory_id`) REFERENCES `factories`(`id`) ON UPDATE no action ON DELETE cascade
);
