# ADR-0032 — MM-QA-004 Slice 2: identity event PII (F-04 code half)

## Status

Accepted. Standalone remediation slice per the MM-QA-004 disposition
(ADR-0031 amendment 2026-07-17); executes
`docs/qa/MM-QA-004-Remediation-Plan.md` Part 1 Slice 2.

## Context

`domain_events` is retained indefinitely ("keep" row in the erasure
runbook), yet two identity v1 contracts persisted contact PII there:
`identity.user_registered.v1` carried `phone`/`email` and
`identity.patient_profile_created.v1` carried `normalizedPhone`. This
is MM-QA-002 F-07, left "pending" in ADR-0011 and never resolved;
MM-QA-004 F-04 raised it to High because the erasure runbook
additionally claimed the opposite ("id-only by design — verified" —
corrected to interim wording in PR 0). The owner ruled: v2 id-only
identity events per convention #3, plus redaction of existing rows.

## Decision

1. **v2 contracts (id-only).** `identity.user_registered.v2`
   (`userId`, `userType`) and `identity.patient_profile_created.v2`
   (`profileId`, `source`). All emit sites switch to v2 — four sites,
   not the plan's named two: the plan listed
   `complete-provider-signup.ts` and `ensure-patient-registration.ts`,
   but `patient_profile_created.v1` was also emitted from
   `create-guest-patient-profile.ts` and `claim-patient-profile.ts`
   (deviation of record: all four updated, else PII kept flowing).
2. **v1 schemas: unchanged, exactly as shipped.** Owner ruling
   (2026-07-17, PR #74 review): shipped contract versions are never
   edited — convention #3 and the spirit of plan rule 5 apply to
   contracts, not just migrations. Both v1 contracts stay in
   `IDENTITY_EVENTS` with `phone`/`email`/`normalizedPhone` declared
   as shipped; they are the historical record of what those rows
   contained. The redaction migration alone is the fix for existing
   data. (This supersedes the PR's first revision, which had removed
   the PII fields from the v1 schemas; that edit was reverted.) The
   no-PII schema test is scoped to v2 and all future identity schemas
   only. No subscriber ever consumed either event (verified: no
   handler registration for any identity event).
3. **Migration `0010_redact_identity_event_pii.sql`** (NEW file — rule
   5 / F-21: shipped migrations are never edited): a single idempotent
   `UPDATE` stripping `phone`/`email`/`normalizedPhone` keys from the
   two identity v1 event names, guarded by `payload ?| …` so re-runs
   match zero rows. Ids, names, versions, aggregate refs, status, and
   timestamps preserved.
4. **Runbook row → current true state**: "id-only as of migration
   0010 — redaction verified in test against legacy-shaped rows;
   production verification lands with deploy (D10)"; the interim PR 0
   wording and the erasure-cell qualification are removed. The F-04
   final close-out flips this to plain "verified" only after 0010 has
   run against the production database (owner ruling 2026-07-17).

**MM-QA-002 F-07 is closed by this slice** (this ADR is its
remediation of record; ADR-0011's "remains pending" note is superseded
here).

## Tests (convention #12)

- `packages/contracts/test/identity-events.test.ts`: event-set pin
  updated to the 8 contracts (6 v1 + 2 v2); a new test asserts **no
  identity event payload schema beyond the shipped Phase 2 v1
  contracts contains `phone`/`email`/`normalizedPhone`** (the F-04
  done-when, scoped per the owner ruling in Decision 2 — v1 is the
  historical record and is excluded by an explicit frozen name list,
  so any future schema, v1 of a new event included, is checked); v2
  parse/reject cases; v1 cases assert the shipped shapes unchanged.
- `apps/api/test/identity/event-pii-redaction.test.ts`: inserts
  legacy-shaped v1 rows plus a booking-event control row into a
  migrated database, executes the 0010 SQL from the shipped file, and
  asserts: PII keys removed, ids/payload siblings/timestamps
  preserved, control row untouched, and a second execution matches
  zero rows (idempotency).
- Existing identity integration tests updated from v1 to v2 names.

## Gate

Pre-slice (uncached, WSL): format GREEN · lint/typecheck 20/20 · test
11/11 tasks, 955 tests / 127 files · build 3/3 — at main `028dc01`
(CI verified green by owner, run 29597966848).
Post-slice, revision 1 (uncached, WSL): format GREEN · lint/typecheck
20/20 · test 11/11 tasks, **959 tests / 128 files, 0 failed** (api
580/68, contracts 53/7; +4 tests / +1 file over baseline) · build 3/3.
The first post-slice run caught a `consistent-type-imports` lint error
in the new contracts test (type-only `zod` import); fixed, full gate
re-run from scratch.
Post-slice, revision 2 (owner-ruling revisions; uncached, WSL, repo
root): format GREEN · lint/typecheck 20/20 · test 11/11 tasks, **960
tests / 128 files, 0 failed** (api 580/68, contracts 54/7 — the
strip-on-parse test was replaced by the two restored shipped v1
cases) · build 3/3.
