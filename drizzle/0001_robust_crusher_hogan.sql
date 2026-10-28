CREATE INDEX `executions_factory_day_idx` ON `execution_records` (`factory_id`,`day_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `meters_ingest_token_uq` ON `meters` (`ingest_token_hash`);--> statement-breakpoint
CREATE INDEX `model_fits_factory_time_idx` ON `model_fits` (`factory_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `tariff_periods_version_idx` ON `tariff_periods` (`tariff_version_id`);