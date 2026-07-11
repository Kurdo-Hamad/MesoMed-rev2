CREATE TABLE "blocked_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_location_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blocked_slots_window_check" CHECK ("blocked_slots"."starts_at" < "blocked_slots"."ends_at")
);
--> statement-breakpoint
CREATE TABLE "doctor_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_profile_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "practice_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_ckb" text NOT NULL,
	"city_id" uuid,
	"address_en" text,
	"address_ar" text,
	"address_ckb" text,
	"phone" text,
	"time_zone" text DEFAULT 'Asia/Baghdad' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_breaks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"weekly_schedule_id" uuid NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	CONSTRAINT "schedule_breaks_window_check" CHECK ("schedule_breaks"."start_time" < "schedule_breaks"."end_time")
);
--> statement-breakpoint
CREATE TABLE "secretary_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"secretary_user_id" text NOT NULL,
	"doctor_location_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weekly_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_location_id" uuid NOT NULL,
	"day_of_week" integer NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"slot_duration_minutes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weekly_schedules_day_of_week_check" CHECK ("weekly_schedules"."day_of_week" between 0 and 6),
	CONSTRAINT "weekly_schedules_duration_check" CHECK ("weekly_schedules"."slot_duration_minutes" > 0),
	CONSTRAINT "weekly_schedules_window_check" CHECK ("weekly_schedules"."start_time" < "weekly_schedules"."end_time")
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_location_id" uuid NOT NULL,
	"patient_profile_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'booked' NOT NULL,
	"booked_via" text NOT NULL,
	"created_by" text,
	"note" text,
	"cancellation_reason" text,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointments_status_check" CHECK ("appointments"."status" in ('booked', 'confirmed', 'checked_in', 'in_progress', 'completed', 'cancelled', 'no_show')),
	CONSTRAINT "appointments_booked_via_check" CHECK ("appointments"."booked_via" in ('guest_web', 'patient_account', 'secretary_walk_in')),
	CONSTRAINT "appointments_window_check" CHECK ("appointments"."starts_at" < "appointments"."ends_at")
);
--> statement-breakpoint
ALTER TABLE "blocked_slots" ADD CONSTRAINT "blocked_slots_doctor_location_id_doctor_locations_id_fk" FOREIGN KEY ("doctor_location_id") REFERENCES "public"."doctor_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_locations" ADD CONSTRAINT "doctor_locations_location_id_practice_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."practice_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_breaks" ADD CONSTRAINT "schedule_breaks_weekly_schedule_id_weekly_schedules_id_fk" FOREIGN KEY ("weekly_schedule_id") REFERENCES "public"."weekly_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secretary_assignments" ADD CONSTRAINT "secretary_assignments_doctor_location_id_doctor_locations_id_fk" FOREIGN KEY ("doctor_location_id") REFERENCES "public"."doctor_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_schedules" ADD CONSTRAINT "weekly_schedules_doctor_location_id_doctor_locations_id_fk" FOREIGN KEY ("doctor_location_id") REFERENCES "public"."doctor_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "blocked_slots_doctor_location_idx" ON "blocked_slots" USING btree ("doctor_location_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "doctor_locations_doctor_location_unique" ON "doctor_locations" USING btree ("doctor_profile_id","location_id");--> statement-breakpoint
CREATE INDEX "doctor_locations_location_id_idx" ON "doctor_locations" USING btree ("location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "practice_locations_slug_unique" ON "practice_locations" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "schedule_breaks_schedule_idx" ON "schedule_breaks" USING btree ("weekly_schedule_id");--> statement-breakpoint
CREATE UNIQUE INDEX "secretary_assignments_unique" ON "secretary_assignments" USING btree ("secretary_user_id","doctor_location_id");--> statement-breakpoint
CREATE INDEX "secretary_assignments_doctor_location_idx" ON "secretary_assignments" USING btree ("doctor_location_id");--> statement-breakpoint
CREATE INDEX "weekly_schedules_doctor_location_idx" ON "weekly_schedules" USING btree ("doctor_location_id","day_of_week");--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_active_slot_unique" ON "appointments" USING btree ("doctor_location_id","starts_at") WHERE "appointments"."status" in ('booked', 'confirmed', 'checked_in', 'in_progress');--> statement-breakpoint
CREATE INDEX "appointments_doctor_location_starts_idx" ON "appointments" USING btree ("doctor_location_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_patient_profile_idx" ON "appointments" USING btree ("patient_profile_id","starts_at");