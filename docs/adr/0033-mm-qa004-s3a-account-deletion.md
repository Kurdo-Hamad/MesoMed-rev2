# ADR-0033 — MM-QA-004 Slice 3a: self-service account deletion (F-02 code half)

## Status

Accepted. Standalone remediation slice per the MM-QA-004 disposition
(ADR-0031 amendment 2026-07-17); executes
`docs/qa/MM-QA-004-Remediation-Plan.md` Part 1 Slice 3, code half (3a).
The content half (privacy policy + terms, 3b) is a separate PR.

## Context

F-02 (High): no account-deletion flow existed anywhere in the repo, yet
the retention-erasure runbook's `user`/auth row prescribed an "account
deletion flow (identity module)" that did not exist — a dangling
reference, and an Apple/Google store-submission blocker (in-app account
deletion is required for apps that support account creation). This slice
builds the flow and makes the runbook reference true.

## Decision

1. **Self-only tRPC procedure `identity.deleteAccount`.** No input: it
   always acts on `ctx.session.userId`, so there is no id parameter and
   one account can never delete another. Authenticated-only (denies
   anonymous with `UNAUTHORIZED`/401).

2. **The command executes the runbook §1 matrix** for the caller:
   - `patient_profiles` (identity-owned): anonymized in place — `fullName`
     emptied, `normalizedPhone` set to a per-row `deleted:<id>` tombstone
     (the column is NOT NULL + UNIQUE; the tombstone is non-PII, unique,
     and can never be a real E.164 number so the profile is never
     re-claimable), `email`/`dateOfBirth`/`gender` nulled, `userId`
     nulled. **The row and its id survive**, so the clinical record and
     appointments that reference it stay referentially intact. The
     "clinical hold check" (runbook §4 step 2) is therefore **structural,
     not a runtime check**: this flow never deletes clinical rows and
     never drops the profile id, so the hold is honored unconditionally —
     and identity avoids a cross-module read of `encounters` (convention
     #1).
   - Better Auth `user` + sessions: deleted via
     `internalAdapter.deleteUser` + `deleteUserSessions` (the same
     internal-adapter channel `recover-provider-account.ts` already uses).
     The `user` delete cascades `session` / `account` / `user_roles` /
     `device_tokens` / `user_channel_preferences` / `provider_profiles` at
     the DB (their FKs are `ON DELETE CASCADE`).
   - `notification_log` (communication-owned): pruned by a communication
     subscriber to a new **id-only** event `identity.account_deleted.v1`
     `{ userId, patientProfileId }` (convention #1 — identity never writes
     another module's tables; convention #3 — the event carries no PII,
     consistent with the F-04 posture).
   - `appointments`, `encounters`/`visit_notes`/`prescriptions`,
     `clinical_access_log`, `domain_events`: **kept** per the matrix
     (pseudonymous / medical-records obligation / permanent audit /
     pseudonymous id-only).

3. **Ordering.** The identity transaction (anonymize + emit) commits
   first, then the Better Auth user is deleted. If the delete fails after
   the commit, the caller still holds a session and can retry — anonymize
   is idempotent and re-emitting only re-runs an idempotent prune. No
   subscriber consumed identity events before this slice, so adding one is
   additive.

## Deviation of record — `send_rate_events` / `abuse_alerts`

These two kernel tables are keyed by **phone number**, not by user/profile
id. The matrix's erasure column reads "delete by key" / "delete/NULL key
by subject", and the manual §4 procedure deletes them. The self-service
flow does **not**, for two reasons that cannot both be satisfied
otherwise:

- The `account_deleted` event is id-only (F-04). Carrying the phone
  through it to let a handler delete by key would re-introduce contact PII
  into `domain_events` — exactly what F-04 forbade.
- Deleting them synchronously inside the identity command (which does hold
  the phone pre-anonymization) would be identity writing kernel abuse
  tables.

Instead the flow relies on the matrix's own stated mechanisms for these
rows: `send_rate_events` is erased by its **7-day retention window**
(already built, ADR-0028 §2); `abuse_alerts` are retained as anti-abuse
**security records** (the matrix's "manual for now", legitimate-interest
basis) — an account holder should not be able to erase abuse evidence
instantly by self-deleting. The matrix-coverage test pins this behavior.
**Flagged for owner review**: if the owner wants these erased in-flow, the
clean path is a kernel-published `deleteByKey` helper called from the
command (not the event) — a follow-up, not silently added here.

## Tests (convention #12)

- `apps/api/test/identity/delete-account.test.ts`: seeds a full subject
  account (auth rows, profile, device tokens, both notification-log
  linkages, phone-keyed rate/abuse rows, a clinical record + appointment)
  plus a second control account; deletes the subject; asserts **every
  matrix row's disposition** (deleted / anonymized / kept) and that the
  control account is entirely untouched (self-only). Second test: an
  anonymous caller is rejected 401.
- `packages/contracts/test/identity-events.test.ts`: event-set pin updated
  to 9 contracts; `account_deleted.v1` parse case; the no-PII schema test
  (scoped to v2+/new schemas) already covers it — it is id-only.

## Gate

Pre-slice (uncached, WSL, repo root): format GREEN · lint/typecheck 20/20
· test 11/11 tasks, 960 tests / 128 files · build 3/3 — at main `f3fb4dc`
(CI verified green by owner, run 29602973256).
Post-slice (uncached, WSL, repo root): format GREEN · lint/typecheck 20/20
· test 11/11 tasks, **963 tests / 129 files, 0 failed** (api 582/69,
contracts 55/7; +3 tests / +1 file over baseline) · build 3/3. The first
post-slice run caught two seed defects in the new integration test (two
accounts booked the same slot → slot-uniqueness invariant; and asserting
`clinical_access_log` at an exact seeded count when the append-only audit
trigger writes a row per clinical write) — both root-caused and fixed
structurally (distinct slots per account; assert the audit count is
unchanged by deletion), not re-run around.
