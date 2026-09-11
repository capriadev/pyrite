CREATE TYPE "public"."validator_status" AS ENUM('unchecked', 'valid', 'expired', 'invalid');--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"label" text NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"salt" text NOT NULL,
	"status" "movement_status" DEFAULT 'active' NOT NULL,
	"validator_status" "validator_status" DEFAULT 'unchecked' NOT NULL,
	"last_checked" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
