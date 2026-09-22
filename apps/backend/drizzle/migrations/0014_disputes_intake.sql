CREATE TABLE "dispute_intake_dismissals" (
	"movement_id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "is_service" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "is_system" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "dispute_intake_dismissals" ADD CONSTRAINT "dispute_intake_dismissals_movement_id_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."movements"("id") ON DELETE cascade ON UPDATE no action;
