ALTER TABLE "alerts" ADD COLUMN "emailed_at" bigint;--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "email_error" text;--> statement-breakpoint
ALTER TABLE "factories" ADD COLUMN "alert_emails" text;