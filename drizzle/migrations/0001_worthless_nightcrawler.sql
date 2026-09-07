CREATE TYPE "public"."balance_key" AS ENUM('cash_ars', 'digital_ars', 'cash_usd', 'digital_usd');--> statement-breakpoint
CREATE TYPE "public"."currency" AS ENUM('ARS', 'USD');--> statement-breakpoint
CREATE TYPE "public"."movement_status" AS ENUM('active', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."movement_type" AS ENUM('income', 'expense');--> statement-breakpoint
CREATE TABLE "balances" (
	"key" "balance_key" PRIMARY KEY NOT NULL,
	"amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" "movement_type" NOT NULL,
	"status" "movement_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "movement_type" NOT NULL,
	"amount_currency" "currency" NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"paid_currency" "currency" NOT NULL,
	"paid_amount" numeric(14, 2) NOT NULL,
	"rate_used" numeric(14, 4) NOT NULL,
	"balance_source" "balance_key" NOT NULL,
	"category_id" uuid NOT NULL,
	"platform_id" uuid,
	"description" text NOT NULL,
	"note" text,
	"date" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "movement_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platforms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"status" "movement_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "movements" ADD CONSTRAINT "movements_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movements" ADD CONSTRAINT "movements_platform_id_platforms_id_fk" FOREIGN KEY ("platform_id") REFERENCES "public"."platforms"("id") ON DELETE no action ON UPDATE no action;