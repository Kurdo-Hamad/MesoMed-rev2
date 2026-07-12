CREATE TABLE "abuse_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"channel" text NOT NULL,
	"key" text NOT NULL,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_spend" (
	"channel" text NOT NULL,
	"day" date NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "channel_spend_channel_day_pk" PRIMARY KEY("channel","day")
);
--> statement-breakpoint
CREATE TABLE "send_rate_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"platform" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_profile_id" uuid,
	"user_id" text,
	"appointment_id" uuid,
	"template" text NOT NULL,
	"channel" text NOT NULL,
	"destination" text,
	"locale" text NOT NULL,
	"params_json" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"denied_reason" text,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_log_status_check" CHECK ("notification_log"."status" in ('pending', 'sent', 'failed', 'denied'))
);
--> statement-breakpoint
CREATE TABLE "user_channel_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"push_enabled" boolean DEFAULT true NOT NULL,
	"whatsapp_enabled" boolean DEFAULT true NOT NULL,
	"sms_enabled" boolean DEFAULT true NOT NULL,
	"email_enabled" boolean DEFAULT true NOT NULL,
	"locale" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_channel_preferences" ADD CONSTRAINT "user_channel_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "abuse_alerts_kind_created_idx" ON "abuse_alerts" USING btree ("kind","created_at");--> statement-breakpoint
CREATE INDEX "send_rate_events_scope_key_sent_idx" ON "send_rate_events" USING btree ("scope","key","sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX "device_tokens_token_unique" ON "device_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX "device_tokens_user_idx" ON "device_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_log_dedupe_key_unique" ON "notification_log" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "notification_log_pending_due_idx" ON "notification_log" USING btree ("status","next_attempt_at") WHERE "notification_log"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "notification_log_channel_created_idx" ON "notification_log" USING btree ("channel","created_at");--> statement-breakpoint
CREATE INDEX "notification_log_patient_profile_idx" ON "notification_log" USING btree ("patient_profile_id");--> statement-breakpoint
CREATE INDEX "appointments_status_starts_idx" ON "appointments" USING btree ("status","starts_at");--> statement-breakpoint
COMMENT ON COLUMN "notification_log"."destination" IS 'PII: destination phone number / email / device token. Crypto-shred scope; retention 12-24 months (ADR-0011).';--> statement-breakpoint
COMMENT ON COLUMN "notification_log"."params_json" IS 'Rendered-template params (names/times) re-read at plan time. Crypto-shred scope; retention 12-24 months (ADR-0011).';--> statement-breakpoint
COMMENT ON COLUMN "notification_log"."appointment_id" IS 'Appointment linkage. Crypto-shred scope; retention 12-24 months (ADR-0011).';--> statement-breakpoint
COMMENT ON COLUMN "send_rate_events"."key" IS 'May carry a phone number or IP address. Crypto-shred scope; prune after the rate window (operational retention: days).';--> statement-breakpoint
COMMENT ON COLUMN "abuse_alerts"."key" IS 'May carry a phone number. Crypto-shred scope; retention 12-24 months (ADR-0011).';--> statement-breakpoint
COMMENT ON COLUMN "device_tokens"."token" IS 'Expo push token (device credential). Crypto-shred scope (ADR-0011).';
