-- Custom SQL migration file, put your code below! --
CREATE TYPE "public"."trial_unit" AS ENUM('day', 'week', 'month');--> statement-breakpoint
ALTER TABLE "task_payments" ADD COLUMN "trial_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "task_payments" ADD COLUMN "trial_unit" "trial_unit" DEFAULT 'day' NOT NULL;--> statement-breakpoint
UPDATE "task_payments" SET "trial_count" = "trial_days";--> statement-breakpoint
ALTER TABLE "task_payments" DROP COLUMN "trial_days";