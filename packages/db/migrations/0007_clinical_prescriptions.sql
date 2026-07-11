CREATE TABLE "patient_medical_profile" (
	"patient_profile_id" uuid PRIMARY KEY NOT NULL,
	"blood_type" text DEFAULT 'unknown' NOT NULL,
	"allergies" text[] DEFAULT '{}' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patient_medical_profile_blood_type_check" CHECK ("patient_medical_profile"."blood_type" in ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'unknown'))
);
--> statement-breakpoint
CREATE TABLE "patient_reported_medications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_profile_id" uuid NOT NULL,
	"medication_name" text NOT NULL,
	"dosage" text,
	"source" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patient_reported_medications_source_check" CHECK ("patient_reported_medications"."source" in ('self_prescribed', 'over_the_counter'))
);
--> statement-breakpoint
CREATE TABLE "prescriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"encounter_id" uuid NOT NULL,
	"doctor_profile_id" uuid NOT NULL,
	"patient_profile_id" uuid NOT NULL,
	"medication_name" text NOT NULL,
	"dosage" text NOT NULL,
	"frequency" text NOT NULL,
	"duration" text NOT NULL,
	"instructions" text,
	"status" text DEFAULT 'active' NOT NULL,
	"supersedes_prescription_id" uuid,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prescriptions_status_check" CHECK ("prescriptions"."status" in ('active', 'superseded', 'discontinued')),
	CONSTRAINT "prescriptions_no_self_supersede_check" CHECK ("prescriptions"."supersedes_prescription_id" <> "prescriptions"."id")
);
--> statement-breakpoint
ALTER TABLE "prescriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "clinical_access_log" DROP CONSTRAINT "clinical_access_log_action_check";--> statement-breakpoint
ALTER TABLE "clinical_access_log" ADD COLUMN "prescription_id" uuid;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "patient_reported_medications_patient_idx" ON "patient_reported_medications" USING btree ("patient_profile_id","created_at");--> statement-breakpoint
CREATE INDEX "prescriptions_patient_profile_idx" ON "prescriptions" USING btree ("patient_profile_id","issued_at");--> statement-breakpoint
CREATE INDEX "prescriptions_encounter_idx" ON "prescriptions" USING btree ("encounter_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prescriptions_supersedes_unique" ON "prescriptions" USING btree ("supersedes_prescription_id") WHERE "prescriptions"."supersedes_prescription_id" is not null;--> statement-breakpoint
ALTER TABLE "clinical_access_log" ADD CONSTRAINT "clinical_access_log_action_check" CHECK ("clinical_access_log"."action" in ('encounter_created', 'encounter_read', 'note_added', 'note_amended', 'notes_read', 'support_notes_read', 'grant_created', 'grant_revoked', 'prescription_issued', 'prescription_amended', 'prescription_discontinued', 'prescriptions_read'));--> statement-breakpoint
-- ────────────────────────────────────────────────────────────────────────
-- Hand-written guardrail tail (clinical extension, ADR-0010; §3.5/§3.6 as
-- amended — prescriptions join the clinical RLS tier). Everything below is
-- deliberately outside drizzle's model: triggers, SECURITY DEFINER
-- functions and grants. The drizzle snapshot does not track these objects,
-- so later generated diffs will not fight them.
-- ────────────────────────────────────────────────────────────────────────
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_supersedes_prescription_id_prescriptions_id_fk" FOREIGN KEY ("supersedes_prescription_id") REFERENCES "public"."prescriptions"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- ── Append-only enforcement (§3.5, billing-0006 guard pattern) ─────────
-- Fires for every role, superuser included: prescription content is
-- immutable after insert — corrections are new revisions; the only legal
-- mutations are the status flips active → superseded (amendment, same tx
-- as the new revision) and active → discontinued.
CREATE FUNCTION prescriptions_guard_update() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (to_jsonb(OLD) - 'status' - 'updated_at') IS DISTINCT FROM (to_jsonb(NEW) - 'status' - 'updated_at') THEN
    RAISE EXCEPTION 'PRESCRIPTION_IMMUTABLE: prescription content is append-only — corrections are new revisions, never UPDATEs (ADR-0010)';
  END IF;
  IF NOT (OLD.status = 'active' AND NEW.status IN ('superseded', 'discontinued')) THEN
    RAISE EXCEPTION 'PRESCRIPTION_STATUS_INVALID: % -> % is not a legal transition (only active -> superseded and active -> discontinued)', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER prescriptions_guard_update
  BEFORE UPDATE ON "prescriptions"
  FOR EACH ROW EXECUTE FUNCTION prescriptions_guard_update();
--> statement-breakpoint
CREATE FUNCTION prescriptions_block_delete() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'PRESCRIPTION_IMMUTABLE: prescriptions are clinical records and can never be deleted (ADR-0010)';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER prescriptions_no_delete
  BEFORE DELETE ON "prescriptions"
  FOR EACH ROW EXECUTE FUNCTION prescriptions_block_delete();
--> statement-breakpoint
-- ── Audit trigger extension (§3.5) ─────────────────────────────────────
-- Same function as 0004 with a prescriptions branch appended: INSERTs log
-- issue vs amendment by the supersession link; the amendment's superseded
-- flip logs nothing (the INSERT already recorded it) — only the
-- discontinuation flip produces its own row.
CREATE OR REPLACE FUNCTION clinical_audit_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor text := coalesce(nullif(current_setting('mesomed.clinical_actor', true), ''), current_user);
BEGIN
  IF TG_TABLE_NAME = 'encounters' THEN
    INSERT INTO clinical_access_log (actor_user_id, action, encounter_id)
    VALUES (v_actor, 'encounter_created', NEW.id);
  ELSIF TG_TABLE_NAME = 'visit_notes' THEN
    INSERT INTO clinical_access_log (actor_user_id, action, encounter_id, visit_note_id)
    VALUES (v_actor, CASE WHEN NEW.amends_note_id IS NULL THEN 'note_added' ELSE 'note_amended' END, NEW.encounter_id, NEW.id);
  ELSIF TG_TABLE_NAME = 'support_access_grants' AND TG_OP = 'INSERT' THEN
    INSERT INTO clinical_access_log (actor_user_id, action, encounter_id, grant_id)
    VALUES (v_actor, 'grant_created', NEW.encounter_id, NEW.id);
  ELSIF TG_TABLE_NAME = 'support_access_grants' AND TG_OP = 'UPDATE' THEN
    INSERT INTO clinical_access_log (actor_user_id, action, encounter_id, grant_id)
    VALUES (v_actor, 'grant_revoked', NEW.encounter_id, NEW.id);
  ELSIF TG_TABLE_NAME = 'prescriptions' AND TG_OP = 'INSERT' THEN
    INSERT INTO clinical_access_log (actor_user_id, action, encounter_id, prescription_id)
    VALUES (v_actor, CASE WHEN NEW.supersedes_prescription_id IS NULL THEN 'prescription_issued' ELSE 'prescription_amended' END, NEW.encounter_id, NEW.id);
  ELSIF TG_TABLE_NAME = 'prescriptions' AND TG_OP = 'UPDATE' AND NEW.status = 'discontinued' THEN
    INSERT INTO clinical_access_log (actor_user_id, action, encounter_id, prescription_id)
    VALUES (v_actor, 'prescription_discontinued', NEW.encounter_id, NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER prescriptions_audit
  AFTER INSERT OR UPDATE ON "prescriptions"
  FOR EACH ROW EXECUTE FUNCTION clinical_audit_row();
--> statement-breakpoint
-- ── SECURITY DEFINER access channel (§3.6 as amended by ADR-0010) ──────
-- prescriptions has RLS enabled with ZERO policies and no table grants —
-- unreachable for every non-owner role; these functions are the only path
-- in, and each records the access in clinical_access_log. Application
-- authorization happens BEFORE these are called (kernel role guard +
-- encounter-ownership checks); parameters are belt, not trust.
CREATE FUNCTION clinical_issue_prescription(
  p_encounter_id uuid,
  p_medication_name text,
  p_dosage text,
  p_frequency text,
  p_duration text,
  p_instructions text,
  p_actor text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_encounter encounters%ROWTYPE;
  v_id uuid;
BEGIN
  PERFORM set_config('mesomed.clinical_actor', p_actor, true);
  SELECT * INTO v_encounter FROM encounters e WHERE e.id = p_encounter_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLINICAL_ENCOUNTER_NOT_FOUND';
  END IF;
  INSERT INTO prescriptions (encounter_id, doctor_profile_id, patient_profile_id, medication_name, dosage, frequency, duration, instructions)
  VALUES (p_encounter_id, v_encounter.doctor_profile_id, v_encounter.patient_profile_id, p_medication_name, p_dosage, p_frequency, p_duration, p_instructions)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
--> statement-breakpoint
-- Amendment is atomic HERE: the new revision and the superseded flip of
-- its target happen inside one function call, inside the caller's tx.
CREATE FUNCTION clinical_amend_prescription(
  p_prescription_id uuid,
  p_medication_name text,
  p_dosage text,
  p_frequency text,
  p_duration text,
  p_instructions text,
  p_actor text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_target prescriptions%ROWTYPE;
  v_id uuid;
BEGIN
  PERFORM set_config('mesomed.clinical_actor', p_actor, true);
  SELECT * INTO v_target FROM prescriptions p WHERE p.id = p_prescription_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRESCRIPTION_NOT_FOUND';
  END IF;
  IF v_target.status <> 'active' THEN
    RAISE EXCEPTION 'PRESCRIPTION_NOT_ACTIVE';
  END IF;
  INSERT INTO prescriptions (encounter_id, doctor_profile_id, patient_profile_id, medication_name, dosage, frequency, duration, instructions, supersedes_prescription_id)
  VALUES (v_target.encounter_id, v_target.doctor_profile_id, v_target.patient_profile_id, p_medication_name, p_dosage, p_frequency, p_duration, p_instructions, v_target.id)
  RETURNING id INTO v_id;
  UPDATE prescriptions SET status = 'superseded', updated_at = now() WHERE id = v_target.id;
  RETURN v_id;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION clinical_discontinue_prescription(
  p_prescription_id uuid,
  p_actor text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_target prescriptions%ROWTYPE;
BEGIN
  PERFORM set_config('mesomed.clinical_actor', p_actor, true);
  SELECT * INTO v_target FROM prescriptions p WHERE p.id = p_prescription_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRESCRIPTION_NOT_FOUND';
  END IF;
  IF v_target.status <> 'active' THEN
    RAISE EXCEPTION 'PRESCRIPTION_NOT_ACTIVE';
  END IF;
  UPDATE prescriptions SET status = 'discontinued', updated_at = now() WHERE id = v_target.id;
  RETURN v_target.id;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION clinical_read_prescriptions(
  p_actor text,
  p_patient_profile_id uuid DEFAULT NULL,
  p_prescription_id uuid DEFAULT NULL
) RETURNS SETOF prescriptions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_patient_profile_id IS NULL AND p_prescription_id IS NULL THEN
    RAISE EXCEPTION 'CLINICAL_READ_REQUIRES_SCOPE';
  END IF;
  INSERT INTO clinical_access_log (actor_user_id, action, encounter_id, prescription_id)
  SELECT p_actor, 'prescriptions_read', p.encounter_id, p.id
  FROM prescriptions p
  WHERE (p_patient_profile_id IS NULL OR p.patient_profile_id = p_patient_profile_id)
    AND (p_prescription_id IS NULL OR p.id = p_prescription_id);
  RETURN QUERY
  SELECT p.*
  FROM prescriptions p
  WHERE (p_patient_profile_id IS NULL OR p.patient_profile_id = p_patient_profile_id)
    AND (p_prescription_id IS NULL OR p.id = p_prescription_id)
  ORDER BY p.issued_at DESC, p.id;
END;
$$;
--> statement-breakpoint
-- ── Privileges (§3.6 least-privilege API role) ─────────────────────────
-- 0004's GRANT ON ALL TABLES was point-in-time; new tables get their own
-- grants here. prescriptions joins the clinical tier: zero table
-- privileges (functions only). The patient-authored tables take ordinary
-- DML — ownership is enforced in the handlers (layer b), deliberately
-- outside the RLS tier (ADR-0010).
REVOKE ALL ON "prescriptions" FROM mesomed_api;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "patient_medical_profile" TO mesomed_api;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "patient_reported_medications" TO mesomed_api;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION
  clinical_issue_prescription(uuid, text, text, text, text, text, text),
  clinical_amend_prescription(uuid, text, text, text, text, text, text),
  clinical_discontinue_prescription(uuid, text),
  clinical_read_prescriptions(text, uuid, uuid)
FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION
  clinical_issue_prescription(uuid, text, text, text, text, text, text),
  clinical_amend_prescription(uuid, text, text, text, text, text, text),
  clinical_discontinue_prescription(uuid, text),
  clinical_read_prescriptions(text, uuid, uuid)
TO mesomed_api;
