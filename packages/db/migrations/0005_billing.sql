CREATE TABLE "facility_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"tier_id" uuid NOT NULL,
	"tier_expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listing_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"rank" integer NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_ckb" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listing_tiers_rank_check" CHECK ("listing_tiers"."rank" >= 1)
);
--> statement-breakpoint
CREATE TABLE "subscription_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"amount" integer NOT NULL,
	"currency" text NOT NULL,
	"gateway" text NOT NULL,
	"reference" text,
	"recorded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_payments_window_check" CHECK ("subscription_payments"."period_start" < "subscription_payments"."period_end"),
	CONSTRAINT "subscription_payments_amount_check" CHECK ("subscription_payments"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_profile_id" uuid NOT NULL,
	"status" text DEFAULT 'inactive' NOT NULL,
	"paid_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_status_check" CHECK ("subscriptions"."status" in ('active', 'grace_period', 'inactive'))
);
--> statement-breakpoint
CREATE TABLE "tier_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"tier_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"amount" integer NOT NULL,
	"currency" text NOT NULL,
	"gateway" text NOT NULL,
	"reference" text,
	"recorded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tier_payments_window_check" CHECK ("tier_payments"."period_start" < "tier_payments"."period_end"),
	CONSTRAINT "tier_payments_amount_check" CHECK ("tier_payments"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "tier_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tier_id" uuid NOT NULL,
	"country_code" text NOT NULL,
	"currency" text NOT NULL,
	"amount" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tier_prices_amount_check" CHECK ("tier_prices"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "subscription_active" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "facility_tiers" ADD CONSTRAINT "facility_tiers_tier_id_listing_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."listing_tiers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tier_payments" ADD CONSTRAINT "tier_payments_tier_id_listing_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."listing_tiers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tier_prices" ADD CONSTRAINT "tier_prices_tier_id_listing_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."listing_tiers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "facility_tiers_facility_unique" ON "facility_tiers" USING btree ("facility_id");--> statement-breakpoint
CREATE UNIQUE INDEX "listing_tiers_key_unique" ON "listing_tiers" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "listing_tiers_rank_unique" ON "listing_tiers" USING btree ("rank");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_payments_idempotency_key_unique" ON "subscription_payments" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "subscription_payments_subscription_idx" ON "subscription_payments" USING btree ("subscription_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_doctor_profile_unique" ON "subscriptions" USING btree ("doctor_profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tier_payments_idempotency_key_unique" ON "tier_payments" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "tier_payments_period_unique" ON "tier_payments" USING btree ("facility_id","tier_id","period_start","period_end");--> statement-breakpoint
CREATE INDEX "tier_payments_facility_idx" ON "tier_payments" USING btree ("facility_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tier_prices_tier_country_unique" ON "tier_prices" USING btree ("tier_id","country_code");--> statement-breakpoint
-- ── Hand-written tail (outside drizzle's model) ────────────────────────
-- Least-privilege API role (§3.6): migration 0004's GRANT ON ALL TABLES
-- was point-in-time; tables created here need their own grants. Billing
-- tables take ordinary DML — the clinical-tier restrictions do not apply.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  "subscriptions",
  "subscription_payments",
  "listing_tiers",
  "tier_prices",
  "facility_tiers",
  "tier_payments"
TO mesomed_api;
