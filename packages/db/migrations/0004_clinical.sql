CREATE TABLE "clinical_access_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" text NOT NULL,
	"action" text NOT NULL,
	"encounter_id" uuid,
	"visit_note_id" uuid,
	"grant_id" uuid,
	CONSTRAINT "clinical_access_log_action_check" CHECK ("clinical_access_log"."action" in ('encounter_created', 'encounter_read', 'note_added', 'note_amended', 'notes_read', 'support_notes_read', 'grant_created', 'grant_revoked'))
);
--> statement-breakpoint
CREATE TABLE "encounters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"doctor_profile_id" uuid NOT NULL,
	"patient_profile_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "encounters_window_check" CHECK ("encounters"."starts_at" < "encounters"."ends_at")
);
--> statement-breakpoint
ALTER TABLE "encounters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "support_access_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"encounter_id" uuid NOT NULL,
	"admin_user_id" text NOT NULL,
	"granted_by" text NOT NULL,
	"reason" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_access_grants_window_check" CHECK ("support_access_grants"."created_at" < "support_access_grants"."expires_at"),
	CONSTRAINT "support_access_grants_reason_check" CHECK (length("support_access_grants"."reason") >= 5)
);
--> statement-breakpoint
CREATE TABLE "visit_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"encounter_id" uuid NOT NULL,
	"amends_note_id" uuid,
	"author_user_id" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visit_notes_no_self_amend_check" CHECK ("visit_notes"."amends_note_id" <> "visit_notes"."id")
);
--> statement-breakpoint
ALTER TABLE "visit_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "support_access_grants" ADD CONSTRAINT "support_access_grants_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_notes" ADD CONSTRAINT "visit_notes_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clinical_access_log_encounter_idx" ON "clinical_access_log" USING btree ("encounter_id","occurred_at");--> statement-breakpoint
CREATE INDEX "clinical_access_log_actor_idx" ON "clinical_access_log" USING btree ("actor_user_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "encounters_appointment_unique" ON "encounters" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "encounters_doctor_profile_idx" ON "encounters" USING btree ("doctor_profile_id","starts_at");--> statement-breakpoint
CREATE INDEX "encounters_patient_profile_idx" ON "encounters" USING btree ("patient_profile_id","starts_at");--> statement-breakpoint
CREATE INDEX "support_access_grants_encounter_idx" ON "support_access_grants" USING btree ("encounter_id");--> statement-breakpoint
CREATE INDEX "support_access_grants_admin_idx" ON "support_access_grants" USING btree ("admin_user_id","expires_at");--> statement-breakpoint
CREATE INDEX "visit_notes_encounter_idx" ON "visit_notes" USING btree ("encounter_id","created_at");--> statement-breakpoint
CREATE INDEX "visit_notes_amends_idx" ON "visit_notes" USING btree ("amends_note_id");--> statement-breakpoint
-- ────────────────────────────────────────────────────────────────────────
-- Hand-written guardrail tail (MM-PLAN-001 §3.5/§3.6, §5 Phase 5).
-- Everything below is deliberately outside drizzle's model: triggers,
-- SECURITY DEFINER functions, the least-privilege API role and its grants.
-- The drizzle snapshot does not track these objects, so later generated
-- diffs will not fight them.
-- ────────────────────────────────────────────────────────────────────────
ALTER TABLE "visit_notes" ADD CONSTRAINT "visit_notes_amends_note_id_visit_notes_id_fk" FOREIGN KEY ("amends_note_id") REFERENCES "public"."visit_notes"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Least-privilege API role (§3.6). NOLOGIN: production attaches LOGIN via
-- ALTER ROLE/a member role in ops config; tests adopt it with SET ROLE.
-- Roles are cluster-wide, so creation is guarded for idempotency.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'mesomed_api') THEN
    CREATE ROLE mesomed_api NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
-- ── Append-only enforcement (§3.5) ─────────────────────────────────────
-- Fires for every role, superuser included: correcting a visit note means
-- appending an amendment; the audit log is never rewritten.
CREATE FUNCTION clinical_block_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'CLINICAL_APPEND_ONLY: % rows are immutable (% denied)', TG_TABLE_NAME, TG_OP;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER visit_notes_append_only
  BEFORE UPDATE OR DELETE ON "visit_notes"
  FOR EACH ROW EXECUTE FUNCTION clinical_block_mutation();
--> statement-breakpoint
CREATE TRIGGER clinical_access_log_append_only
  BEFORE UPDATE OR DELETE ON "clinical_access_log"
  FOR EACH ROW EXECUTE FUNCTION clinical_block_mutation();
--> statement-breakpoint
-- Support grants are auditable state: the only legal mutation is revocation
-- (revoked_at NULL → instant), everything else is frozen at creation.
CREATE FUNCTION clinical_guard_grant_update() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (to_jsonb(OLD) - 'revoked_at') IS DISTINCT FROM (to_jsonb(NEW) - 'revoked_at')
     OR OLD.revoked_at IS NOT NULL
     OR NEW.revoked_at IS NULL THEN
    RAISE EXCEPTION 'CLINICAL_GRANT_IMMUTABLE: only revocation (revoked_at NULL -> instant) is allowed';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER support_access_grants_guard_update
  BEFORE UPDATE ON "support_access_grants"
  FOR EACH ROW EXECUTE FUNCTION clinical_guard_grant_update();
--> statement-breakpoint
CREATE TRIGGER support_access_grants_no_delete
  BEFORE DELETE ON "support_access_grants"
  FOR EACH ROW EXECUTE FUNCTION clinical_block_mutation();
--> statement-breakpoint
-- ── Audit trigger (§3.5, ported concept from the old 0002 migration) ───
-- SECURITY DEFINER so the writing role needs no privilege on the log; the
-- actor comes from a transaction-local GUC the access functions set, with
-- current_user as the fallback — the trigger logs even when someone
-- bypasses the application layer entirely.
CREATE FUNCTION clinical_audit_row() RETURNS trigger
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
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER encounters_audit
  AFTER INSERT ON "encounters"
  FOR EACH ROW EXECUTE FUNCTION clinical_audit_row();
--> statement-breakpoint
CREATE TRIGGER visit_notes_audit
  AFTER INSERT ON "visit_notes"
  FOR EACH ROW EXECUTE FUNCTION clinical_audit_row();
--> statement-breakpoint
CREATE TRIGGER support_access_grants_audit
  AFTER INSERT OR UPDATE ON "support_access_grants"
  FOR EACH ROW EXECUTE FUNCTION clinical_audit_row();
--> statement-breakpoint
-- ── SECURITY DEFINER access channel (§3.6 clinical-tier RLS) ───────────
-- encounters/visit_notes have RLS enabled with ZERO policies and no table
-- grants: for every non-owner role the tables are unreachable. These
-- functions run as the table owner (migration role) and are the only path
-- in — each one records the access in clinical_access_log. Application
-- authorization (kernel role guard + ownership checks) happens BEFORE
-- these are called; the scope parameters are belt, not trust.
CREATE FUNCTION clinical_create_encounter(
  p_appointment_id uuid,
  p_doctor_profile_id uuid,
  p_patient_profile_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_actor text
) RETURNS TABLE (encounter_id uuid, created boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM set_config('mesomed.clinical_actor', p_actor, true);
  INSERT INTO encounters (appointment_id, doctor_profile_id, patient_profile_id, starts_at, ends_at)
  VALUES (p_appointment_id, p_doctor_profile_id, p_patient_profile_id, p_starts_at, p_ends_at)
  ON CONFLICT (appointment_id) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT v_id, true;
  ELSE
    RETURN QUERY SELECT e.id, false FROM encounters e WHERE e.appointment_id = p_appointment_id;
  END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION clinical_read_encounters(
  p_actor text,
  p_encounter_id uuid DEFAULT NULL,
  p_doctor_profile_id uuid DEFAULT NULL,
  p_patient_profile_id uuid DEFAULT NULL
) RETURNS SETOF encounters
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_encounter_id IS NULL AND p_doctor_profile_id IS NULL AND p_patient_profile_id IS NULL THEN
    RAISE EXCEPTION 'CLINICAL_READ_REQUIRES_SCOPE';
  END IF;
  INSERT INTO clinical_access_log (actor_user_id, action, encounter_id)
  SELECT p_actor, 'encounter_read', e.id
  FROM encounters e
  WHERE (p_encounter_id IS NULL OR e.id = p_encounter_id)
    AND (p_doctor_profile_id IS NULL OR e.doctor_profile_id = p_doctor_profile_id)
    AND (p_patient_profile_id IS NULL OR e.patient_profile_id = p_patient_profile_id);
  RETURN QUERY
  SELECT e.*
  FROM encounters e
  WHERE (p_encounter_id IS NULL OR e.id = p_encounter_id)
    AND (p_doctor_profile_id IS NULL OR e.doctor_profile_id = p_doctor_profile_id)
    AND (p_patient_profile_id IS NULL OR e.patient_profile_id = p_patient_profile_id)
  ORDER BY e.starts_at DESC, e.id;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION clinical_add_visit_note(
  p_encounter_id uuid,
  p_amends_note_id uuid,
  p_author text,
  p_content text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_target visit_notes%ROWTYPE;
  v_id uuid;
BEGIN
  PERFORM set_config('mesomed.clinical_actor', p_author, true);
  IF NOT EXISTS (SELECT FROM encounters e WHERE e.id = p_encounter_id) THEN
    RAISE EXCEPTION 'CLINICAL_ENCOUNTER_NOT_FOUND';
  END IF;
  IF p_amends_note_id IS NOT NULL THEN
    SELECT * INTO v_target FROM visit_notes n WHERE n.id = p_amends_note_id;
    IF NOT FOUND OR v_target.encounter_id <> p_encounter_id OR v_target.amends_note_id IS NOT NULL THEN
      -- Amendments target an ORIGINAL note of the SAME encounter (§3.5).
      RAISE EXCEPTION 'CLINICAL_AMEND_TARGET_INVALID';
    END IF;
  END IF;
  INSERT INTO visit_notes (encounter_id, amends_note_id, author_user_id, content)
  VALUES (p_encounter_id, p_amends_note_id, p_author, p_content)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION clinical_read_visit_notes(
  p_actor text,
  p_encounter_id uuid
) RETURNS SETOF visit_notes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT FROM encounters e WHERE e.id = p_encounter_id) THEN
    RAISE EXCEPTION 'CLINICAL_ENCOUNTER_NOT_FOUND';
  END IF;
  INSERT INTO clinical_access_log (actor_user_id, action, encounter_id)
  VALUES (p_actor, 'notes_read', p_encounter_id);
  RETURN QUERY
  SELECT n.* FROM visit_notes n
  WHERE n.encounter_id = p_encounter_id
  ORDER BY n.created_at, n.id;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION clinical_grant_support_access(
  p_encounter_id uuid,
  p_admin_user_id text,
  p_granted_by text,
  p_reason text,
  p_expires_at timestamptz
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM set_config('mesomed.clinical_actor', p_granted_by, true);
  IF NOT EXISTS (SELECT FROM encounters e WHERE e.id = p_encounter_id) THEN
    RAISE EXCEPTION 'CLINICAL_ENCOUNTER_NOT_FOUND';
  END IF;
  IF p_expires_at <= now() THEN
    RAISE EXCEPTION 'SUPPORT_GRANT_INVALID';
  END IF;
  INSERT INTO support_access_grants (encounter_id, admin_user_id, granted_by, reason, expires_at)
  VALUES (p_encounter_id, p_admin_user_id, p_granted_by, p_reason, p_expires_at)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION clinical_revoke_support_access(
  p_grant_id uuid,
  p_actor text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_grant support_access_grants%ROWTYPE;
BEGIN
  PERFORM set_config('mesomed.clinical_actor', p_actor, true);
  SELECT * INTO v_grant FROM support_access_grants g WHERE g.id = p_grant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUPPORT_GRANT_INVALID';
  END IF;
  IF v_grant.revoked_at IS NOT NULL THEN
    RETURN false;
  END IF;
  UPDATE support_access_grants SET revoked_at = now() WHERE id = p_grant_id;
  RETURN true;
END;
$$;
--> statement-breakpoint
-- Time-boxed support access (§3.5): the expiry check lives HERE, in the
-- database, so an application bug cannot serve content past the window.
CREATE FUNCTION clinical_support_read_visit_notes(
  p_grant_id uuid,
  p_actor text
) RETURNS SETOF visit_notes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_grant support_access_grants%ROWTYPE;
BEGIN
  SELECT * INTO v_grant FROM support_access_grants g WHERE g.id = p_grant_id;
  IF NOT FOUND OR v_grant.admin_user_id <> p_actor OR v_grant.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'SUPPORT_GRANT_INVALID';
  END IF;
  IF now() >= v_grant.expires_at THEN
    RAISE EXCEPTION 'SUPPORT_GRANT_EXPIRED';
  END IF;
  INSERT INTO clinical_access_log (actor_user_id, action, encounter_id, grant_id)
  VALUES (p_actor, 'support_notes_read', v_grant.encounter_id, p_grant_id);
  RETURN QUERY
  SELECT n.* FROM visit_notes n
  WHERE n.encounter_id = v_grant.encounter_id
  ORDER BY n.created_at, n.id;
END;
$$;
--> statement-breakpoint
-- ── Privileges (§3.6 least-privilege API role) ─────────────────────────
-- The API role gets ordinary DML everywhere EXCEPT the clinical tier:
--   encounters / visit_notes  → zero table privileges (functions only)
--   clinical_access_log       → SELECT only (admin audit views later)
--   support_access_grants     → SELECT only (mutations via functions)
GRANT USAGE ON SCHEMA public TO mesomed_api;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO mesomed_api;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mesomed_api;
--> statement-breakpoint
REVOKE ALL ON "encounters" FROM mesomed_api;
--> statement-breakpoint
REVOKE ALL ON "visit_notes" FROM mesomed_api;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON "clinical_access_log" FROM mesomed_api;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON "support_access_grants" FROM mesomed_api;
--> statement-breakpoint
-- No role but the API role may execute the clinical channel (PUBLIC gets
-- EXECUTE by default — strip it).
REVOKE EXECUTE ON FUNCTION
  clinical_create_encounter(uuid, uuid, uuid, timestamptz, timestamptz, text),
  clinical_read_encounters(text, uuid, uuid, uuid),
  clinical_add_visit_note(uuid, uuid, text, text),
  clinical_read_visit_notes(text, uuid),
  clinical_grant_support_access(uuid, text, text, text, timestamptz),
  clinical_revoke_support_access(uuid, text),
  clinical_support_read_visit_notes(uuid, text)
FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION
  clinical_create_encounter(uuid, uuid, uuid, timestamptz, timestamptz, text),
  clinical_read_encounters(text, uuid, uuid, uuid),
  clinical_add_visit_note(uuid, uuid, text, text),
  clinical_read_visit_notes(text, uuid),
  clinical_grant_support_access(uuid, text, text, text, timestamptz),
  clinical_revoke_support_access(uuid, text),
  clinical_support_read_visit_notes(uuid, text)
TO mesomed_api;
