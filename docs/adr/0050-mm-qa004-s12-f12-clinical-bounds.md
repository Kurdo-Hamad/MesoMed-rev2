# ADR-0050 — MM-QA-004 Slice 12: clinical list bounds (F-12)

## Status

Accepted under the 2026-07-18 owner override (ADR-0031 amendment).

## Context

MM-QA-004 F-12 (MEDIUM): the four clinical list reads took no limit,
the SECURITY DEFINER `clinical_read_encounters` returned every match
AND wrote one permanent `clinical_access_log` row per MATCHED encounter
per call, and `patientClinicalHistory` ran an N+1 `readVisitNotes`
loop. Every dashboard load was an O(N) read plus O(N) append-only audit
write.

## Decision

- **Contracts**: `doctorEncounters`/`myEncounters` gain an optional
  `{ limit 1..200 default 50, cursor }` input (no-arg calls keep
  working); history gains the same; `encounterNotes` gains a limit
  whose default 200 IS the clamp; list/history outputs gain
  `nextCursor`. Keyset cursor = `(starts_at DESC, id)`, opaque
  base64url codec in `packages/domain/clinical/encounter-cursor.ts`
  (directory-cursor precedent; malformed → page one). Both frozen
  surface pins pass untouched — all changes additive.
- **Migration `0012_clinical_read_bounds.sql`** (0004 never edited):
  rebuilds `clinical_read_encounters` with limit/keyset params and the
  audit INSERT restructured over the SAME page CTE the RETURN QUERY
  serves — **audit rows equal returned rows exactly**. Deviation from
  the planning sketch, deliberate: `CREATE OR REPLACE` with added
  parameters would have created a second overload and left the old
  unbounded 4-arg channel callable — the function is DROPped and
  recreated, with the 0004 REVOKE/GRANT posture re-established
  explicitly. New `clinical_read_visit_notes_bulk(actor, uuid[])`
  mirrors the single-encounter function's semantics and per-encounter
  audit action; the N+1 loop is now ONE bulk call.
- **Exact-limit variant** (not limit+1 probing): the function receives
  the exact page size so the audit invariant stays airtight;
  `nextCursor` means "page was full" (a final full page yields one
  empty follow-up).

## Tests

`apps/api/test/clinical/bounds.test.ts` (9) incl. THE invariant: 5
seeded, limit 2 → exactly 2 new `encounter_read` rows whose ids equal
the returned page (fails by construction against the old unbounded
function); full cursor walk (no overlap/gap); 400 on limit 999;
history N+1 gone with output shape preserved; existing clinical suite
(150) incl. the rls pinned audit sequences unchanged.

## Gate

Pre-slice: format GREEN · lint/typecheck 20/20 · test 11/11 tasks,
1128 tests / 138 files, zero failed · build 3/3 — the Slice 11
post-slice gate on the tree that squash-merged verbatim to main
`fdfc16f` (CI verified green, run 29642710176).
Post-slice: format GREEN · lint/typecheck 20/20 · test 11/11 tasks,
1144 tests / 140 files, zero failed · build 3/3. An intermediate gate
ran lint-RED: the harvested files reintroduced three `@mesomed/db`
root-hub imports and the Slice 8 write-isolation guardrail caught them
— its first real catch; imports corrected to the module entrypoint.
