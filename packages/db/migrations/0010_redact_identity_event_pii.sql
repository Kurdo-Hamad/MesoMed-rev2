-- MM-QA-004 F-04 (closes MM-QA-002 F-07): identity v1 events persisted
-- contact PII in domain_events, which is retained indefinitely. New
-- emissions are the id-only v2 contracts; this migration redacts the PII
-- keys from every stored identity v1 payload in place, preserving id,
-- name, version, aggregate refs, status, and timestamps.
--
-- Idempotent by construction: the WHERE clause matches only rows still
-- carrying at least one PII key, and jsonb '-' on an absent key is a
-- no-op. Ships as a NEW migration file (F-21 rule) — shipped migrations
-- are never edited.
UPDATE "domain_events"
SET "payload" = "payload" - 'phone' - 'email' - 'normalizedPhone'
WHERE "name" IN ('identity.user_registered.v1', 'identity.patient_profile_created.v1')
  AND "payload" ?| ARRAY['phone', 'email', 'normalizedPhone'];
