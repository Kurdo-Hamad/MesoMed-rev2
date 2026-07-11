CREATE TABLE "billing_charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payer" text NOT NULL,
	"reason" text NOT NULL,
	"provider_id" uuid NOT NULL,
	"booking_id" uuid,
	"subscription_id" uuid,
	"patient_profile_id" uuid,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"rate_kind" text,
	"rate_value" bigint,
	"rate_base_minor" bigint,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"gateway_id" text,
	"gateway_charge_ref" text,
	"idempotency_key" text NOT NULL,
	"reverses_charge_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_charges_payer_check" CHECK ("billing_charges"."payer" in ('provider', 'patient')),
	CONSTRAINT "billing_charges_reason_check" CHECK ("billing_charges"."reason" in ('commission', 'per_booking_fee', 'subscription_fee', 'cancellation_fee', 'no_show_fee')),
	CONSTRAINT "billing_charges_status_check" CHECK ("billing_charges"."status" in ('pending', 'settled', 'void', 'refunded')),
	CONSTRAINT "billing_charges_amount_check" CHECK ("billing_charges"."amount_minor" > 0),
	CONSTRAINT "billing_charges_payer_reason_check" CHECK (("billing_charges"."reason" in ('cancellation_fee', 'no_show_fee') and "billing_charges"."payer" = 'patient')
          or ("billing_charges"."reason" in ('commission', 'per_booking_fee', 'subscription_fee') and "billing_charges"."payer" = 'provider')),
	CONSTRAINT "billing_charges_booking_ref_check" CHECK ("billing_charges"."reason" = 'subscription_fee' or "billing_charges"."booking_id" is not null),
	CONSTRAINT "billing_charges_period_check" CHECK ("billing_charges"."reason" <> 'subscription_fee'
          or ("billing_charges"."period_start" is not null and "billing_charges"."period_end" is not null and "billing_charges"."period_start" < "billing_charges"."period_end")),
	CONSTRAINT "billing_charges_rate_kind_check" CHECK ("billing_charges"."rate_kind" is null or "billing_charges"."rate_kind" in ('monthly_fee', 'per_booking_fee', 'commission_pct'))
);
--> statement-breakpoint
CREATE TABLE "billing_policy_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"outcome" text NOT NULL,
	"window_hours_snapshot" integer,
	"fee_minor" bigint DEFAULT 0 NOT NULL,
	"currency" text,
	"collection_enabled" boolean NOT NULL,
	"charge_id" uuid,
	"evaluated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_policy_evaluations_trigger_check" CHECK ("billing_policy_evaluations"."trigger" in ('cancellation', 'no_show')),
	CONSTRAINT "billing_policy_evaluations_outcome_check" CHECK ("billing_policy_evaluations"."outcome" in ('no_policy', 'policy_disabled', 'within_free_window', 'fee_zero', 'fee_applicable')),
	CONSTRAINT "billing_policy_evaluations_fee_check" CHECK ("billing_policy_evaluations"."fee_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "billing_rate_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" text NOT NULL,
	"model" text NOT NULL,
	"rate_kind" text NOT NULL,
	"value" bigint NOT NULL,
	"currency" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_rate_config_model_check" CHECK ("billing_rate_config"."model" in ('flat_monthly', 'commission')),
	CONSTRAINT "billing_rate_config_rate_kind_check" CHECK ("billing_rate_config"."rate_kind" in ('monthly_fee', 'per_booking_fee', 'commission_pct')),
	CONSTRAINT "billing_rate_config_value_check" CHECK ("billing_rate_config"."value" >= 0),
	CONSTRAINT "billing_rate_config_pct_bounds_check" CHECK ("billing_rate_config"."rate_kind" <> 'commission_pct' or "billing_rate_config"."value" <= 10000),
	CONSTRAINT "billing_rate_config_combo_check" CHECK (("billing_rate_config"."model" = 'flat_monthly' and "billing_rate_config"."rate_kind" in ('monthly_fee', 'per_booking_fee'))
          or ("billing_rate_config"."model" = 'commission' and "billing_rate_config"."rate_kind" = 'commission_pct'))
);
--> statement-breakpoint
CREATE TABLE "provider_billing_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"category" text NOT NULL,
	"model" text NOT NULL,
	"tier_id" uuid,
	"booking_value_minor" bigint,
	"trial_ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_billing_config_model_check" CHECK ("provider_billing_config"."model" in ('flat_monthly', 'commission')),
	CONSTRAINT "provider_billing_config_commission_base_check" CHECK ("provider_billing_config"."model" <> 'commission' or "provider_billing_config"."booking_value_minor" is not null),
	CONSTRAINT "provider_billing_config_booking_value_check" CHECK ("provider_billing_config"."booking_value_minor" is null or "provider_billing_config"."booking_value_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "provider_cancellation_policy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"free_cancellation_window_hours" integer NOT NULL,
	"cancellation_fee_minor" bigint NOT NULL,
	"no_show_fee_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_cancellation_policy_window_check" CHECK ("provider_cancellation_policy"."free_cancellation_window_hours" >= 0),
	CONSTRAINT "provider_cancellation_policy_fees_check" CHECK ("provider_cancellation_policy"."cancellation_fee_minor" >= 0 and "provider_cancellation_policy"."no_show_fee_minor" >= 0)
);
--> statement-breakpoint
ALTER TABLE "billing_charges" ADD CONSTRAINT "billing_charges_subscription_id_provider_billing_config_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."provider_billing_config"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_charges" ADD CONSTRAINT "billing_charges_reverses_charge_id_billing_charges_id_fk" FOREIGN KEY ("reverses_charge_id") REFERENCES "public"."billing_charges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_policy_evaluations" ADD CONSTRAINT "billing_policy_evaluations_charge_id_billing_charges_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."billing_charges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_billing_config" ADD CONSTRAINT "provider_billing_config_tier_id_listing_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."listing_tiers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_charges_idempotency_key_unique" ON "billing_charges" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_charges_booking_reason_unique" ON "billing_charges" USING btree ("booking_id","reason") WHERE "billing_charges"."booking_id" is not null and "billing_charges"."reverses_charge_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_charges_subscription_period_unique" ON "billing_charges" USING btree ("provider_id","period_start") WHERE "billing_charges"."reason" = 'subscription_fee' and "billing_charges"."reverses_charge_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_charges_reversal_unique" ON "billing_charges" USING btree ("reverses_charge_id") WHERE "billing_charges"."reverses_charge_id" is not null;--> statement-breakpoint
CREATE INDEX "billing_charges_provider_idx" ON "billing_charges" USING btree ("provider_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_policy_evaluations_booking_trigger_unique" ON "billing_policy_evaluations" USING btree ("booking_id","trigger");--> statement-breakpoint
CREATE INDEX "billing_policy_evaluations_provider_idx" ON "billing_policy_evaluations" USING btree ("provider_id","evaluated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_rate_config_key_unique" ON "billing_rate_config" USING btree ("category","model","rate_kind");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_billing_config_provider_unique" ON "provider_billing_config" USING btree ("provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_cancellation_policy_provider_unique" ON "provider_cancellation_policy" USING btree ("provider_id");--> statement-breakpoint
-- ── Hand-written tail (outside drizzle's model) ────────────────────────
-- (1) Least-privilege grants (§3.6): migration 0004's GRANT ON ALL TABLES
-- was point-in-time; tables created here need their own grants. Billing
-- tables take ordinary DML — the clinical-tier restrictions do not apply,
-- but the charge ledger carries its own integrity triggers below.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  "billing_rate_config",
  "provider_billing_config",
  "provider_cancellation_policy",
  "billing_policy_evaluations"
TO mesomed_api;--> statement-breakpoint
-- The ledger is deliberately NOT deletable by the API role: charge rows
-- are financial facts; corrections are new rows (void/refund).
GRANT SELECT, INSERT, UPDATE ON "billing_charges" TO mesomed_api;--> statement-breakpoint
-- (2) Ledger immutability (ADR-0009): settled/void/refunded charge rows
-- are immutable facts, and the monetary identity of ANY charge row can
-- never be rewritten. The single legal UPDATE is pending -> settled/void
-- plus its settlement metadata (gateway id/ref, settled_at, updated_at).
-- Same enforcement depth as the clinical append-only triggers (0004).
CREATE FUNCTION billing_charges_guard_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'BILLING_CHARGE_IMMUTABLE: % rows are immutable facts — corrections are new rows (void/refund), never UPDATEs', OLD.status;
  END IF;
  IF NEW.payer            IS DISTINCT FROM OLD.payer
     OR NEW.reason        IS DISTINCT FROM OLD.reason
     OR NEW.provider_id   IS DISTINCT FROM OLD.provider_id
     OR NEW.booking_id    IS DISTINCT FROM OLD.booking_id
     OR NEW.subscription_id    IS DISTINCT FROM OLD.subscription_id
     OR NEW.patient_profile_id IS DISTINCT FROM OLD.patient_profile_id
     OR NEW.amount_minor  IS DISTINCT FROM OLD.amount_minor
     OR NEW.currency      IS DISTINCT FROM OLD.currency
     OR NEW.rate_kind     IS DISTINCT FROM OLD.rate_kind
     OR NEW.rate_value    IS DISTINCT FROM OLD.rate_value
     OR NEW.rate_base_minor    IS DISTINCT FROM OLD.rate_base_minor
     OR NEW.period_start  IS DISTINCT FROM OLD.period_start
     OR NEW.period_end    IS DISTINCT FROM OLD.period_end
     OR NEW.idempotency_key    IS DISTINCT FROM OLD.idempotency_key
     OR NEW.reverses_charge_id IS DISTINCT FROM OLD.reverses_charge_id
     OR NEW.created_at    IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'BILLING_CHARGE_IMMUTABLE: the monetary identity of a charge row can never change — corrections are new rows';
  END IF;
  IF NEW.status NOT IN ('settled', 'void', 'pending') THEN
    RAISE EXCEPTION 'BILLING_CHARGE_IMMUTABLE: pending may only transition to settled or void ("refunded" rows are created as reversals, not reached by UPDATE)';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER billing_charges_guard_update
  BEFORE UPDATE ON "billing_charges"
  FOR EACH ROW EXECUTE FUNCTION billing_charges_guard_update();--> statement-breakpoint
CREATE FUNCTION billing_charges_block_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'BILLING_CHARGE_IMMUTABLE: charge rows are financial facts and can never be deleted';
END $$;--> statement-breakpoint
CREATE TRIGGER billing_charges_no_delete
  BEFORE DELETE ON "billing_charges"
  FOR EACH ROW EXECUTE FUNCTION billing_charges_block_delete();
