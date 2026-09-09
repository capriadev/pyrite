CREATE TABLE "api_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"status" "movement_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "detail" text;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "group_id" uuid;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_group_id_api_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."api_groups"("id") ON DELETE set null ON UPDATE no action;