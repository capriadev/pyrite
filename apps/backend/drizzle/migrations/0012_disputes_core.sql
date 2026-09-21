ALTER TYPE "public"."expectation_status" ADD VALUE 'suggestion';--> statement-breakpoint
CREATE TYPE "public"."dispute_resolution" AS ENUM('cancelled', 'not_registered', 'paid_late', 'linked_manual', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."dispute_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."dispute_type" AS ENUM('missing', 'late', 'unplanned');--> statement-breakpoint
CREATE TYPE "public"."link_source" AS ENUM('declared', 'manual');--> statement-breakpoint
CREATE TABLE "dispute_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expectation_id" uuid NOT NULL,
	"movement_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dispute_candidates_pair_key" UNIQUE("expectation_id","movement_id")
);
--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "dispute_type" NOT NULL,
	"task_id" uuid,
	"expectation_id" uuid,
	"movement_id" uuid,
	"status" "dispute_status" DEFAULT 'open' NOT NULL,
	"resolution" "dispute_resolution",
	"resolution_note" text,
	"evidence" jsonb,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "reconciliation_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expectation_id" uuid NOT NULL,
	"movement_id" uuid NOT NULL,
	"matched_by" "link_source" DEFAULT 'declared' NOT NULL,
	"amount_deviation" numeric(14, 2),
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reconciliation_links_expectation_key" UNIQUE("expectation_id"),
	CONSTRAINT "reconciliation_links_movement_key" UNIQUE("movement_id")
);
--> statement-breakpoint
CREATE TABLE "task_category_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_category_links_task_category_key" UNIQUE("task_id","category_id")
);
--> statement-breakpoint
ALTER TABLE "dispute_candidates" ADD CONSTRAINT "dispute_candidates_expectation_id_task_expectations_id_fk" FOREIGN KEY ("expectation_id") REFERENCES "public"."task_expectations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_candidates" ADD CONSTRAINT "dispute_candidates_movement_id_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."movements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_expectation_id_task_expectations_id_fk" FOREIGN KEY ("expectation_id") REFERENCES "public"."task_expectations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_movement_id_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."movements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_links" ADD CONSTRAINT "reconciliation_links_expectation_id_task_expectations_id_fk" FOREIGN KEY ("expectation_id") REFERENCES "public"."task_expectations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_links" ADD CONSTRAINT "reconciliation_links_movement_id_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."movements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_category_links" ADD CONSTRAINT "task_category_links_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_category_links" ADD CONSTRAINT "task_category_links_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;
