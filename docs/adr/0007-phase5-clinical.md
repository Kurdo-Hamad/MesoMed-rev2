# ADR-0007 — Phase 5: Clinical

**Status:** Accepted
**Phase:** 5 (MM-PLAN-001 §5) — clinical module: encounters (1:1 with
completed appointments, subscriber-created), append-only visit notes with
the amendments model, the `clinical_access_log` audit populated at the
database layer, time-boxed admin support-access grants, and targeted RLS
on the clinical tier.
**Builds on:** ADR-0003 (kernel/outbox, idempotent handler registry),
ADR-0006 (booking lifecycle, `booking.completed.v1` snapshot payload).

## Decisions

### 1. The subscriber is the only encounter-creation path — proven, not just stated

Encounters are created exclusively by `clinical.create-encounter`, the
idempotent subscriber on `booking.completed.v1`. There is no
encounter-creating tRPC procedure, and a router-introspection meta-test
asserts the mutation set stays `{addVisitNote, amendVisitNote,
grantSupportAccess, revokeSupportAccess}`. Idempotency is two layers deep
and both are tested by forced redelivery: the kernel's `processed_events`
claim absorbs normal duplicates, and `encounters_appointment_unique` + `ON
CONFLICT DO NOTHING` absorbs redelivery even after the claim is erased
(simulating a handler rename). The `clinical.encounter_created.v1` event
is emitted only when the row was actually created, in the same
transaction. The encounter denormalizes the event snapshot
(`doctorProfileId`, `patientProfileId`, occurrence window), so clinical
never joins booking/directory/identity tables (§3.1).

### 2. The entire clinical tier is behind a SECURITY DEFINER channel — writes included

MM-PLAN-001 §3.6 requires deny-all direct SELECT via RLS with access
through SECURITY DEFINER functions. We widened this deliberately: the
`mesomed_api` role has **zero table privileges** on `encounters` and
`visit_notes` (writes included), and both tables carry `ENABLE ROW LEVEL
SECURITY` with **zero policies** — deny-all by construction. The only
channel is the function set from migration 0004
(`clinical_create_encounter`, `clinical_read_encounters`,
`clinical_add_visit_note`, `clinical_read_visit_notes`,
`clinical_grant_support_access`, `clinical_revoke_support_access`,
`clinical_support_read_visit_notes`), `EXECUTE` revoked from `PUBLIC` and
granted to `mesomed_api` alone. Rationale: with RLS-but-writable tables,
an API bug could still corrupt clinical rows; with a function channel the
DB validates the amendments invariant and audits every touch regardless of
application correctness. RLS is deliberately **not** `FORCE`d: the
functions run as the table owner and must bypass it; the RLS meta-test
proves the backstop by temporarily granting SELECT and asserting zero rows
still come back.

### 3. Audit semantics: writes by trigger, reads inside the channel

The ported concept from the old 0002 migration is a SECURITY DEFINER
audit trigger — but PostgreSQL has no SELECT triggers, so the plan's
"audit rows produced by the DB trigger for every read/write path" is
implemented as: **writes** are logged by `AFTER INSERT` triggers on
`encounters`/`visit_notes`/`support_access_grants` (SECURITY DEFINER, so
the writing role needs no privilege on the log; fires on any write,
including ones that bypass the application entirely), and **reads** are
logged inside the SECURITY DEFINER read functions — which the
zero-grant/RLS posture makes the only possible read path for the API
role. The actor is a transaction-local GUC (`mesomed.clinical_actor`) set
by the channel functions, falling back to `current_user` so an
out-of-band write is still attributed. Gate tests assert audit rows for
every exercised path: `encounter_created`, `encounter_read`, `note_added`,
`note_amended`, `notes_read`, `grant_created`, `grant_revoked`,
`support_notes_read`.

### 4. Append-only is enforced at the DB for every role, owner included

`visit_notes` and `clinical_access_log` carry `BEFORE UPDATE OR DELETE`
triggers that raise unconditionally — asserted in tests against both the
API role (permission denied before the trigger is even reached) and the
table owner/superuser (trigger fires). Corrections are amendment rows:
`amends_note_id` references the original, amendments are one level deep
(an amendment cannot be amended — enforced as a typed error in the
command via `@mesomed/domain/clinical` and re-checked inside
`clinical_add_visit_note`, proven by calling the channel directly).
`support_access_grants` rows are immutable except the single legal
transition `revoked_at NULL → instant`, enforced by a guard trigger that
also blocks un-revoking and expiry extension.

### 5. Support grants: self-issued, reasoned, time-boxed, DB-enforced expiry

An admin issues a grant to themselves with a mandatory reason (≥ 5 chars,
checked at contract, table and function layers) and an expiry validated by
the pure policy in `packages/domain/clinical` (future instant, ≤ 72h
window). The expiry check that matters lives in
`clinical_support_read_visit_notes`: `now() >= expires_at` raises
`SUPPORT_GRANT_EXPIRED` in the database, proven by a time-controlled test
that reads successfully inside a 1.5s window, fails through the API after
it, and fails again when the function is invoked directly (no API
involved). Wrong-admin use and revoked grants raise
`SUPPORT_GRANT_INVALID`. Grant metadata (not content) is readable directly
by the API role for admin listings. Self-issuance (vs. a second-admin
approval flow) is a deliberate launch-scope choice: every grant is
evented, audited and time-boxed; four-eyes issuance can be layered on
without schema change.

### 6. Clinical content never enters the outbox

`clinical.visit_note_added.v1` (and all clinical events) carry identifiers
only. `domain_events` is kernel infrastructure readable by ops tooling and
future subscribers; note content exists solely in `visit_notes` behind the
channel. A contract test pins the payload shape (unknown keys stripped)
and an integration test greps every outbox payload for note content.

### 7. `mesomed_api` is established now; full least-privilege rollout stays Phase 10

Migration 0004 creates `mesomed_api` (`NOLOGIN`, idempotent `DO` block —
roles are cluster-wide) and defines the grant surface: ordinary DML on all
current public tables, sequences usage, minus the clinical tier
(encounters/visit_notes: nothing; audit log: SELECT only;
grants table: SELECT only). Tests adopt it with `SET ROLE` on a raw
connection — satisfying the gate's "raw connection using the API role,
bypassing the API entirely". Wiring production's login credentials to
this role, pg-boss schema privileges, and grants for tables added by
later migrations remain part of Phase 10's least-privilege verification,
as planned.

### 8. Typed errors

`SUPPORT_GRANT_INVALID` (→ 403) and `SUPPORT_GRANT_EXPIRED` (→ 412) added
to `contracts/errors` (additive, §3.11). Channel-raised messages are
translated to `AppError`s by walking the drizzle cause chain — clients
switch on `appCode`, never on message strings.

## Deviations & notes

- **"Trigger for every read path" reinterpreted** (see #3): SELECT
  triggers do not exist in PostgreSQL; read auditing lives in the SECURITY
  DEFINER functions that are the only read path. The gate's substance —
  every read/write of clinical data produces an audit row at the database
  layer, unavoidable from the application — holds and is tested.
- **Admins have no encounter-metadata browse procedure.** Grants are
  created against encounter ids obtained from support context (e.g. the
  patient's complaint); encounter existence is validated in-DB at grant
  creation. An admin audit view over `clinical_access_log` is deferred to
  the admin module.
- **Windows test-harness portability** (fixed on the Phase 4 branch,
  commit `506ad65`): embedded-postgres now initdbs with
  `--encoding=UTF8 --no-locale` (system locale yielded WIN1252, rejecting
  ar/ckb fixtures), data-dir teardown retries Windows' async lock release,
  and the otel meta-test's SIGTERM exit-code assertion is skipped on
  win32 (no signal delivery) while CI keeps enforcing it.
- **Directory seed drain budget widened** (120s → 240s): ~150 outbox
  events at the test env's 0.5s worker poll need > 75s even unloaded and
  the idempotency re-run doubles the backlog; the assertion (convergence,
  no duplicates) is unchanged.
- `packages/db/src/schema/index.ts` (the drizzle relational-schema hub)
  still exports kernel+identity only, matching the Phase 3/4 precedent;
  clinical tables are exported from the package root like every other
  module's.

## Gate verification (2026-07-11, local Windows + embedded PG16)

- `pnpm format:check` / `lint` / `typecheck` / `build`: green (10/10 tasks).
- Full test run (`turbo run test --concurrency=1 --force`): **499 tests,
  0 failures** — api 314 (29 files, includes 74 clinical), domain 115,
  contracts 34, db 12, others 24.
- Audit rows asserted for every clinical read/write path exercised
  (`test/clinical/{encounter,notes,support-access,rls}.test.ts`).
- `UPDATE`/`DELETE` on `clinical_access_log`: permission-denied for
  `mesomed_api`, trigger-blocked for the owner (`rls.test.ts`).
- Amendment flow: original immutable at the DB (owner UPDATE blocked),
  amendments append, history ordered (`notes.test.ts`).
- Support-access expiry: succeeds inside window, 412 after, DB function
  refuses directly (`support-access.test.ts`, time-controlled).
- RLS verified on a raw `SET ROLE mesomed_api` connection: direct
  SELECT/INSERT/UPDATE/DELETE denied; grant-then-select returns zero rows
  (policy-free deny-all); the definer channel returns data and audits;
  `PUBLIC` cannot execute the channel (`rls.test.ts`).
