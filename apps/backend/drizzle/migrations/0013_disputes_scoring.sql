CREATE TABLE "task_match_history" (
	"task_id" uuid PRIMARY KEY NOT NULL,
	"average_delay_days" numeric(6, 2) DEFAULT '0' NOT NULL,
	"sample_count" integer DEFAULT 0 NOT NULL,
	"last_amounts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_matched_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dispute_candidates" ADD COLUMN "score" integer;--> statement-breakpoint
ALTER TABLE "dispute_candidates" ADD COLUMN "rank" integer;--> statement-breakpoint
ALTER TABLE "dispute_candidates" ADD COLUMN "signals" jsonb;--> statement-breakpoint
ALTER TABLE "task_match_history" ADD CONSTRAINT "task_match_history_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;
