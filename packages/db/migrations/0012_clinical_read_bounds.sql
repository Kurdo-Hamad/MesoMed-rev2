-- ────────────────────────────────────────────────────────────────────────
-- MM-QA-004 F-12 — clinical list bounds (Slice 12).
--
-- clinical_read_encounters previously returned EVERY encounter in scope
-- and wrote one clinical_access_log row per MATCHED encounter per call.
-- This migration rebuilds it with keyset pagination (starts_at DESC, id
-- ASC) and restructures the body so the audit rows are exactly the rows
-- returned — never more. It also adds clinical_read_visit_notes_bulk so
-- patientClinicalHistory reads one page's notes in a single call instead
-- of one call per encounter (same per-encounter audit granularity).
--
-- NOTE: adding parameters via CREATE OR REPLACE would NOT replace the
-- function — Postgres identifies functions by name + argument types, so
-- it would create a second overload, leave the old unbounded channel
-- callable, and make existing 4-argument calls ambiguous. The old
-- signature is therefore DROPped and recreated; the drop discards its
-- ACLs, so the REVOKE/GRANT pair below re-establishes 0004's privilege
-- posture explicitly (as any new function needs anyway).
-- ────────────────────────────────────────────────────────────────────────
DROP FUNCTION clinical_read_encounters(text, uuid, uuid, uuid);
--> statement-breakpoint
-- Keyset continuation for the fixed order (starts_at DESC, id ASC):
-- "after the cursor row" = starts_at < cursor.starts_at OR
-- (starts_at = cursor.starts_at AND id > cursor.id). NULL p_limit /
-- p_before_* preserve the pre-F-12 call shape (single-encounter reads by
-- the API pass an explicit scope and no page). The audit INSERT consumes
-- the SAME page CTE the query returns, so audit rows == returned rows —
-- the data-modifying CTE runs exactly once even though the outer SELECT
-- is what materializes the result.
CREATE FUNCTION clinical_read_encounters(
  p_actor text,
  p_encounter_id uuid DEFAULT NULL,
  p_doctor_profile_id uuid DEFAULT NULL,
  p_patient_profile_id uuid DEFAULT NULL,
  p_limit integer DEFAULT NULL,
  p_before_starts_at timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL
) RETURNS SETOF encounters
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_encounter_id IS NULL AND p_doctor_profile_id IS NULL AND p_patient_profile_id IS NULL THEN
    RAISE EXCEPTION 'CLINICAL_READ_REQUIRES_SCOPE';
  END IF;
  RETURN QUERY
  WITH page AS (
    SELECT e.*
    FROM encounters e
    WHERE (p_encounter_id IS NULL OR e.id = p_encounter_id)
      AND (p_doctor_profile_id IS NULL OR e.doctor_profile_id = p_doctor_profile_id)
      AND (p_patient_profile_id IS NULL OR e.patient_profile_id = p_patient_profile_id)
      AND (p_before_starts_at IS NULL
           OR e.starts_at < p_before_starts_at
           OR (e.starts_at = p_before_starts_at AND e.id > p_before_id))
    ORDER BY e.starts_at DESC, e.id
    LIMIT p_limit
  ), audit AS (
    INSERT INTO clinical_access_log (actor_user_id, action, encounter_id)
    SELECT p_actor, 'encounter_read', page.id FROM page
  )
  SELECT * FROM page ORDER BY page.starts_at DESC, page.id;
END;
$$;
--> statement-breakpoint
-- Bulk variant of clinical_read_visit_notes for one encounters page:
-- identical semantics per encounter — existence check, one 'notes_read'
-- audit row per (distinct) encounter id, notes in creation order within
-- each encounter (grouping happens in the application layer).
CREATE FUNCTION clinical_read_visit_notes_bulk(
  p_actor text,
  p_encounter_ids uuid[]
) RETURNS SETOF visit_notes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT FROM unnest(p_encounter_ids) AS requested(id)
    WHERE NOT EXISTS (SELECT FROM encounters e WHERE e.id = requested.id)
  ) THEN
    RAISE EXCEPTION 'CLINICAL_ENCOUNTER_NOT_FOUND';
  END IF;
  INSERT INTO clinical_access_log (actor_user_id, action, encounter_id)
  SELECT DISTINCT p_actor, 'notes_read', requested.id
  FROM unnest(p_encounter_ids) AS requested(id);
  RETURN QUERY
  SELECT n.* FROM visit_notes n
  WHERE n.encounter_id = ANY(p_encounter_ids)
  ORDER BY n.encounter_id, n.created_at, n.id;
END;
$$;
--> statement-breakpoint
-- Privilege posture, replicated from 0004: PUBLIC gets EXECUTE by default
-- on new functions — strip it; only the API role may use the channel.
REVOKE EXECUTE ON FUNCTION
  clinical_read_encounters(text, uuid, uuid, uuid, integer, timestamptz, uuid),
  clinical_read_visit_notes_bulk(text, uuid[])
FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION
  clinical_read_encounters(text, uuid, uuid, uuid, integer, timestamptz, uuid),
  clinical_read_visit_notes_bulk(text, uuid[])
TO mesomed_api;
