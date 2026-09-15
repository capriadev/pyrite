CREATE TYPE "public"."rotation_status" AS ENUM('staging', 'applying', 'done', 'failed', 'interrupted');--> statement-breakpoint
CREATE TABLE "rotation_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"section" text NOT NULL,
	"status" "rotation_status" DEFAULT 'staging' NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"processed" integer DEFAULT 0 NOT NULL,
	"pending_canary" jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rotation_staging" (
	"job_id" uuid NOT NULL,
	"target_table" text NOT NULL,
	"row_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"staged_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rotation_staging_pk" PRIMARY KEY("job_id","target_table","row_id")
);
--> statement-breakpoint
ALTER TABLE "rotation_staging" ADD CONSTRAINT "rotation_staging_job_id_rotation_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."rotation_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rotation_jobs_section_open_key" ON "rotation_jobs" USING btree ("section") WHERE status in ('staging', 'applying', 'interrupted');