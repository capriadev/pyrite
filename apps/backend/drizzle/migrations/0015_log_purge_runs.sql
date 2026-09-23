CREATE TYPE "public"."log_purge_origin" AS ENUM('boot', 'interval', 'manual');--> statement-breakpoint
CREATE TABLE "log_purge_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"origin" "log_purge_origin" NOT NULL,
	"retention_days" integer NOT NULL,
	"files" integer DEFAULT 0 NOT NULL,
	"bytes" numeric(20, 0) DEFAULT '0' NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"dir" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone DEFAULT now() NOT NULL
);
