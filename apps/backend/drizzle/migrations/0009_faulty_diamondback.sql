CREATE TYPE "public"."task_priority" AS ENUM('baja', 'media', 'alta', 'critica');--> statement-breakpoint
CREATE TYPE "public"."task_state" AS ENUM('pendiente', 'en_progreso', 'completado', 'cancelado');--> statement-breakpoint
CREATE TABLE "task_sectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"status" "movement_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_sectors_name_key" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "groups" DROP CONSTRAINT "groups_domain_name_key";--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "priority" "task_priority";--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "state" "task_state";--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "group_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "sector_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "linked_expectation_id" uuid;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_parent_id_groups_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_sector_id_task_sectors_id_fk" FOREIGN KEY ("sector_id") REFERENCES "public"."task_sectors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_linked_expectation_id_task_expectations_id_fk" FOREIGN KEY ("linked_expectation_id") REFERENCES "public"."task_expectations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "groups_domain_root_name_key" ON "groups" USING btree ("domain","name") WHERE parent_id is null;--> statement-breakpoint
CREATE UNIQUE INDEX "groups_domain_parent_name_key" ON "groups" USING btree ("domain","parent_id","name") WHERE parent_id is not null;