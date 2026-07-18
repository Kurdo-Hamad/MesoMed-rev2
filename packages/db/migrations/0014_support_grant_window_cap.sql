-- MM-QA-004 F-20 (ADR-0048): the 72-hour support-grant maximum window was
-- enforced only at the application layer (packages/domain
-- support-grant-policy MAX_GRANT_WINDOW_MS); the SECURITY DEFINER
-- function accepted any future expiry, so a direct DB caller (or an
-- app-layer bug) could mint an unbounded grant. CREATE OR REPLACE in a
-- NEW migration file (F-21 rule — 0004 is never edited); the replacement
-- preserves the function's ACLs (CREATE OR REPLACE keeps existing
-- grants), body identical except the added window cap.
CREATE OR REPLACE FUNCTION clinical_grant_support_access(
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
  -- The DB-level backstop for the domain rule MAX_GRANT_WINDOW_MS (72h).
  IF p_expires_at > now() + interval '72 hours' THEN
    RAISE EXCEPTION 'SUPPORT_GRANT_WINDOW_TOO_LONG';
  END IF;
  INSERT INTO support_access_grants (encounter_id, admin_user_id, granted_by, reason, expires_at)
  VALUES (p_encounter_id, p_admin_user_id, p_granted_by, p_reason, p_expires_at)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
