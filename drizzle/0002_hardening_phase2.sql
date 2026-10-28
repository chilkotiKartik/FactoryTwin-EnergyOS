CREATE TABLE `alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`factory_id` text NOT NULL,
	`kind` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`href` text,
	`delivered_at` integer,
	`delivery_error` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`factory_id`) REFERENCES `factories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `alerts_factory_key_uq` ON `alerts` (`factory_id`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `alerts_factory_time_idx` ON `alerts` (`factory_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `audit_events` ADD `prev_hash` text;--> statement-breakpoint
ALTER TABLE `audit_events` ADD `hash` text;--> statement-breakpoint
ALTER TABLE `factories` ADD `alert_webhook_url` text;--> statement-breakpoint
ALTER TABLE `factories` ADD `alert_webhook_secret` text;--> statement-breakpoint
ALTER TABLE `meters` ADD `ingest_token_issued_at` integer;--> statement-breakpoint
ALTER TABLE `meters` ADD `ingest_token_last_used_at` integer;--> statement-breakpoint
ALTER TABLE `meters` ADD `last_counter_kwh` real;--> statement-breakpoint
ALTER TABLE `meters` ADD `last_counter_ts` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `disabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `must_change_password` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `password_changed_at` integer;