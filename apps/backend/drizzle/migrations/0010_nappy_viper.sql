CREATE TYPE "public"."leap_day_mode" AS ENUM('feb28', 'mar01');--> statement-breakpoint
CREATE TABLE "task_dates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"date" date NOT NULL,
	"date_to" date,
	"time" text,
	"time_to" text,
	"label" text,
	CONSTRAINT "task_dates_task_date_key" UNIQUE("task_id","date")
);
--> statement-breakpoint
CREATE TABLE "task_weekdays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"weekday" integer NOT NULL,
	"time" text,
	"time_to" text,
	CONSTRAINT "task_weekdays_task_weekday_key" UNIQUE("task_id","weekday")
);
--> statement-breakpoint
ALTER TABLE "task_expectations" ADD COLUMN "scheduled_time" text;--> statement-breakpoint
ALTER TABLE "task_expectations" ADD COLUMN "time_to" text;--> statement-breakpoint
ALTER TABLE "task_expectations" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "task_recurrence" ADD COLUMN "leap_day_mode" "leap_day_mode" DEFAULT 'feb28' NOT NULL;--> statement-breakpoint
ALTER TABLE "task_recurrence" ADD COLUMN "time" text;--> statement-breakpoint
ALTER TABLE "task_recurrence" ADD COLUMN "time_to" text;--> statement-breakpoint
ALTER TABLE "task_dates" ADD CONSTRAINT "task_dates_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_weekdays" ADD CONSTRAINT "task_weekdays_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;