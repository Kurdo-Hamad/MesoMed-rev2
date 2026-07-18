# ADR-0048 — MM-QA-004 Slice 18: support-grant 72h window cap in the DB (F-20)

## Status

Accepted under the 2026-07-18 owner override (ADR-0031 amendment).

## Context

MM-QA-004 F-20 (LOW): the 72-hour support-grant maximum window was
enforced only at the application layer (`MAX_GRANT_WINDOW_MS` in the
domain policy); `clinical_grant_support_access` accepted any future
expiry, and the policy file's header overstated what the DB re-enforced.

## Decision

- New migration `0014_support_grant_window_cap.sql` (F-21 rule — 0004
  never edited): `CREATE OR REPLACE` of the SECURITY DEFINER function,
  body identical plus `IF p_expires_at > now() + interval '72 hours'
THEN RAISE 'SUPPORT_GRANT_WINDOW_TOO_LONG'`. CREATE OR REPLACE
  preserves the function's ACLs (the 0004 REVOKE/GRANT posture stands).
  Journal entry is added at landing (idx 14, after the 0011–0013
  migrations that precede it in the landing queue).
- The overstating comment in `support-grant-policy.ts` now states the
  true posture: DB-side re-enforcement is expiry-at-use plus (since 0014) the creation-time window cap.

## Tests

`packages/db/test/support-grant-cap.test.ts` (3): in-window grant
succeeds; >72h raises `SUPPORT_GRANT_WINDOW_TOO_LONG`; non-future
expiry still raises `SUPPORT_GRANT_INVALID` — all through the real
SECURITY DEFINER function against a seeded encounter.

## Gate

Pre-slice: format GREEN · lint/typecheck 20/20 · test 11/11 tasks,
1178 tests / 145 files, zero failed · build 3/3 — the Slice 17
post-slice gate on the tree that squash-merged verbatim to main
`2256fd5` (CI verified green, run 29648703007).
Post-slice: format GREEN · lint/typecheck 20/20 · test 11/11 tasks,
1181 tests / 146 files, zero failed · build 3/3.
