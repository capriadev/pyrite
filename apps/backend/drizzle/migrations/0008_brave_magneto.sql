CREATE TYPE "public"."expectation_status" AS ENUM('pending', 'settled', 'exception', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."frequency_unit" AS ENUM('day', 'week', 'month', 'year');--> statement-breakpoint
CREATE TYPE "public"."payment_mode" AS ENUM('recurrente', 'cuotas', 'fija');--> statement-breakpoint
CREATE TYPE "public"."recurrence_end_mode" AS ENUM('never', 'on_date', 'after_count');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('active', 'paused', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."task_type" AS ENUM('puntual', 'recurrente', 'pago');--> statement-breakpoint
CREATE TABLE "task_expectations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"expected_on" date NOT NULL,
	"estimated_amount" numeric(14, 2),
	"currency" "currency",
	"tier_position" integer,
	"status" "expectation_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_expectations_task_date_key" UNIQUE("task_id","expected_on")
);
--> statement-breakpoint
CREATE TABLE "task_payments" (
	"task_id" uuid PRIMARY KEY NOT NULL,
	"mode" "payment_mode" NOT NULL,
	"price_fixed" boolean DEFAULT false NOT NULL,
	"price_amount" numeric(14, 2),
	"price_currency" "currency" DEFAULT 'ARS' NOT NULL,
	"trial_days" integer DEFAULT 0 NOT NULL,
	"installments_count" integer
);
--> statement-breakpoint
CREATE TABLE "task_price_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"amount" numeric(14, 2),
	"currency" "currency" DEFAULT 'ARS' NOT NULL,
	"applies_from_occurrence" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "task_price_tiers_task_position_key" UNIQUE("task_id","position")
);
--> statement-breakpoint
CREATE TABLE "task_recurrence" (
	"task_id" uuid PRIMARY KEY NOT NULL,
	"frequency_unit" "frequency_unit" NOT NULL,
	"interval" integer DEFAULT 1 NOT NULL,
	"ends_mode" "recurrence_end_mode" DEFAULT 'never' NOT NULL,
	"ends_on" date,
	"occurrences_count" integer
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"icon" text,
	"type" "task_type" NOT NULL,
	"status" "task_status" DEFAULT 'active' NOT NULL,
	"notes" text,
	"starts_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_expectations" ADD CONSTRAINT "task_expectations_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_payments" ADD CONSTRAINT "task_payments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_price_tiers" ADD CONSTRAINT "task_price_tiers_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_recurrence" ADD CONSTRAINT "task_recurrence_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;