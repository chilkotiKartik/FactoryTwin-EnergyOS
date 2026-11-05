ALTER TABLE `factories` ADD `site_cap_kva` real;--> statement-breakpoint
ALTER TABLE `factories` ADD `power_factor` real DEFAULT 0.95 NOT NULL;--> statement-breakpoint
ALTER TABLE `factories` ADD `base_load_day_kw` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `factories` ADD `base_load_night_kw` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `factories` ADD `demand_rate_paise_per_kva_month` integer;