CREATE TYPE "public"."credential_type" AS ENUM('password', 'oauth', 'sso', 'api_key', 'other');--> statement-breakpoint
CREATE TABLE "counts_account_groups" (
	"account_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	CONSTRAINT "counts_account_groups_pk" PRIMARY KEY("account_id","group_id")
);
--> statement-breakpoint
CREATE TABLE "counts_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text,
	"url" text,
	"email" text,
	"username" text,
	"number" text,
	"notes" text,
	"credential_type" "credential_type" DEFAULT 'password' NOT NULL,
	"oauth_enabled" "notes_private_flag" DEFAULT 'false' NOT NULL,
	"oauth_src_account_id" uuid,
	"status" "movement_status" DEFAULT 'active' NOT NULL,
	"strength_score" numeric(4, 1),
	"last_password_changed_at" timestamp with time zone,
	"salt" text NOT NULL,
	"password_ciphertext" text,
	"password_iv" text,
	"password_auth_tag" text,
	"secret_value_ciphertext" text,
	"secret_value_iv" text,
	"secret_value_auth_tag" text,
	"phrase_ciphertext" text,
	"phrase_iv" text,
	"phrase_auth_tag" text,
	"twofa_ciphertext" text,
	"twofa_iv" text,
	"twofa_auth_tag" text,
	"questions_ciphertext" text,
	"questions_iv" text,
	"questions_auth_tag" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "counts_password_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"salt" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "counts_account_groups" ADD CONSTRAINT "counts_account_groups_account_id_counts_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."counts_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counts_account_groups" ADD CONSTRAINT "counts_account_groups_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counts_accounts" ADD CONSTRAINT "counts_accounts_oauth_src_fkey" FOREIGN KEY ("oauth_src_account_id") REFERENCES "public"."counts_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counts_password_history" ADD CONSTRAINT "counts_password_history_account_id_counts_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."counts_accounts"("id") ON DELETE cascade ON UPDATE no action;