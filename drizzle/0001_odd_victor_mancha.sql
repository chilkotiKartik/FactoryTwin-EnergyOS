ALTER TABLE "factories" ALTER COLUMN "emission_factor_kg_per_kwh" SET DEFAULT 0.675;--> statement-breakpoint
ALTER TABLE "factories" ALTER COLUMN "emission_factor_source" SET DEFAULT 'CEA CO2 Baseline Database v22.0 (Aug 2026), FY 2025-26 all-India weighted average incl. renewables, Table S';--> statement-breakpoint
-- Move factories still on the old untouched default to CEA v22.0. A value an owner set is left alone.
UPDATE "factories" SET "emission_factor_kg_per_kwh" = 0.675, "emission_factor_source" = 'CEA CO2 Baseline Database v22.0 (Aug 2026), FY 2025-26 all-India weighted average incl. renewables, Table S' WHERE "emission_factor_kg_per_kwh" = 0.727 AND "emission_factor_source" = 'CEA CO2 Baseline Database v20.0, FY 2023-24 weighted average (as cited in deck)';
