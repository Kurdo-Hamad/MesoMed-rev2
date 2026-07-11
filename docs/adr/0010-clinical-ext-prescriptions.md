# ADR-0010 — Clinical Extension: Prescriptions & Patient Medical Profile

**Status:** Accepted
**Phase:** inter-phase slice between Phase 6b and Phase 7 (extends the
Phase 5 clinical module as a dated amendment; does not reopen Phase 5,
does not start Phase 7).
**Builds on:** ADR-0007 (clinical module: encounters, visit notes,
clinical-tier RLS, SECURITY DEFINER channel, audit trigger), ADR-0003
(kernel/outbox), ADR-0006 (booking lifecycle/appointment statuses).

## What this slice adds

Three clinical-owned entities (migration `0007_clinical_prescriptions`):

- **`prescriptions`** — doctor-authored clinical records anchored to an
  encounter. Append-only content (§3.5): an amendment is a NEW active row
  whose `supersedes_prescription_id` points at the prior revision, flipped
  `active → superseded` in the same transaction inside
  `clinical_amend_prescription`; a discontinuation is the status flip
  `active → discontinued` with no content change. Every other status
  transition, any content UPDATE, and any DELETE is rejected at the DB by
  guard triggers (`prescriptions_guard_update` / `prescriptions_no_delete`,
  the migration-0006 billing immutability pattern), superuser included. A
  unique partial index on `supersedes_prescription_id` keeps revision
  chains linear under concurrency.
- **`patient_medical_profile`** — patient-authored: blood type, allergies,
  notes. One row per patient, keyed by the session's claimed patient
  profile id.
- **`patient_reported_medications`** — patient-authored medications
  (self-prescribed / over-the-counter), hard-deletable.

Commands: `issuePrescription` / `amendPrescription` /
`discontinuePrescription` (doctor, owning encounter only),
`upsertMedicalProfile`, `addReportedMedication` /
`removeReportedMedication` (patient, own rows only). Queries:
`patientClinicalHistory` (doctor), `myClinicalRecord` (patient). Events
(outbox row in the command tx): `clinical.prescription_issued.v1`,
`clinical.prescription_amended.v1`,
`clinical.prescription_discontinued.v1`.

## Decisions

### 1. Convention #6 amended: `prescriptions` joins the clinical RLS tier

The clinical-tier RLS list grows from (`encounters`, `visit_notes`) to
include **`prescriptions`**: RLS enabled with zero policies, zero table
grants for `mesomed_api`, access exclusively through SECURITY DEFINER
functions (`clinical_issue_prescription`, `clinical_amend_prescription`,
`clinical_discontinue_prescription`, `clinical_read_prescriptions`), each
recording into `clinical_access_log` (new actions `prescription_issued`,
`prescription_amended`, `prescription_discontinued`, `prescriptions_read`;
new nullable `prescription_id` column). The `clinical_audit_row()` trigger
was extended (CREATE OR REPLACE) with a prescriptions branch. RLS was NOT
extended to any other table. CLAUDE.md convention #6 and MM-PLAN-001 §6
carry the matching amendment.

### 2. Patient medical profile is option A — free upsert, NO history

Locked decision. The profile is patient-owned safety data the patient has
no incentive to falsify; revision history would add audit surface without
a threat model behind it. Consequences, all deliberate:

- no revision history (single row, in-place upsert);
- **no RLS and no audit trigger** on `patient_medical_profile` and
  `patient_reported_medications` — ordinary DML by `mesomed_api`,
  ownership enforced in handlers (§3.6 layer b). The RLS proof test pins
  the exact RLS-enabled table set, so these tables are provably outside
  the tier;
- doctors are read-only (write denied at the kernel role guard);
- editing requires an authenticated patient session — guest-created
  profiles simply have no row until claimed/registered.

Cross-patient writes are impossible by construction: the row key is the
session's claimed profile id; procedure inputs carry no patient id.

### 3. Continuity-of-care access rule for doctor history reads

`clinical.patientClinicalHistory` requires a TREATING RELATIONSHIP: at
least one appointment between the requesting doctor and the patient in
status `booked | confirmed | checked_in | in_progress | completed`
(`TREATING_APPOINTMENT_STATUSES` in `packages/domain/clinical`). Cancelled
and no-show appointments never establish one; a merely booked appointment
does. No relationship → typed FORBIDDEN.

Encounters only materialize COMPLETED appointments, so the pre-completion
statuses cannot be answered from clinical's own tables. The check is
composed from two new published query functions (§3.1's sanctioned
cross-module read surface), each reading only its own module's tables:
`scheduling/queries/doctor-location-refs.ts →
getDoctorLocationIdsForDoctorProfile` (deliberately unfiltered by
`active` — historical relationships count) and
`booking/queries/appointment-refs.ts → hasAppointmentForLocations`.
Clinical composes them in `requireTreatingDoctor`.

A treating doctor READS other doctors' prescriptions but never mutates
them: issue/amend/discontinue remain bound to the owning doctor of the
target encounter, and an amendment inherits its target's encounter.

### 4. Patient-reported medications are structurally distinct from prescriptions

Every query payload carries `prescriptionChains` and
`reportedMedications` as separate arrays with distinct shapes — they are
never merged into one medication list. Reported medications are not
clinical records: hard delete is acceptable, and removal by a non-owner is
indistinguishable from a missing row (no existence oracle).

### 5. Event payloads are ids only; patient-authored writes emit no events

The three prescription events carry identifiers only — never medication
content — extending the Phase 5 privacy invariant (payload Zod schemas
strip unknown keys, proven by contract test). `upsertMedicalProfile` and
the reported-medication commands emit NO events: events are integration
signals (§3.2) and no consumer exists; adding them later is additive
(§3.3). NO notification dispatch and no communication-module code exists
in this slice — communication subscribes to the prescription events in
Phase 7 (MM-DEC §6).

### 6. Cross-module references without FK constraints

`prescriptions.doctor_profile_id` / `patient_profile_id` (denormalized
from the encounter inside `clinical_issue_prescription`) and the
`patient_profile_id` keys of the patient-authored tables follow the
encounters precedent: cross-module ids stored without FK constraints. The
spec-level "FK" is honored intra-module only (`encounter_id`,
`supersedes_prescription_id`).

## Deferred

- **Prescription notifications → Phase 7** (MM-DEC §6): communication
  subscribes to the three events; only test-double subscribers exist today.
- **Patient visibility of visit notes → unscheduled**: `myClinicalRecord`
  deliberately has no visit-note field; adding one later is additive.

## Gate evidence (all green, 2026-07-11)

1. Doctor B with a merely booked appointment retrieves the full history
   including Doctor A's 3-revision chain in order
   (superseded → superseded → active) plus a discontinued single-revision
   chain; the same doctor pre-booking receives typed FORBIDDEN
   (`test/clinical/history.test.ts`).
2. Patient issue/amend/discontinue denied at the role guard; patient
   upserts own profile and manages own reported meds; cross-patient writes
   denied/no-op by construction (`patient-data.test.ts`, `authz.test.ts`
   matrix — extended, meta-test enforced).
3. Amendment atomicity + DB guard trigger meta-tests: content tamper →
   `PRESCRIPTION_IMMUTABLE`, illegal transitions →
   `PRESCRIPTION_STATUS_INVALID`, DELETE → `PRESCRIPTION_IMMUTABLE`, all
   as table owner (`prescriptions.test.ts`).
4. RLS on `prescriptions` proven on a raw non-DEFINER connection: pinned
   RLS table set is exactly (`encounters`, `prescriptions`,
   `visit_notes`) with zero policies; direct DML denied; grant-select
   backstop returns zero rows; definer channel is the working, audited
   path (`rls.test.ts`).
5. `clinical_access_log` rows for prescription writes AND reads, with
   `prescription_id` set (`prescriptions.test.ts`, `history.test.ts`).
6. All three events written to the outbox in the command tx and delivered
   exactly once to test-double subscribers; zero communication-module
   code (`prescriptions.test.ts`).
7. Full repo gate green: lint (boundaries clean) → typecheck → test
   (`--concurrency=1`) → build, no regression of the 615-test baseline.

## Post-merge verification (2026-07-11)

Architecture risk register R8 (score 10) flagged that migration 0007's
`CREATE OR REPLACE FUNCTION clinical_audit_row()` — required to add
prescriptions logging — could silently degrade the Phase-5
encounters/visit_notes audit trail even while prescriptions auditing
itself worked, since `CREATE OR REPLACE` preserves the function's OID and
every trigger already attached to it (`encounters_audit`,
`visit_notes_audit`), so a body regression would not surface as a missing
trigger or a signature mismatch — only as wrong behavior at runtime. This
had not been checked at merge time; it was checked now, verification-only,
with no other changes:

- **Static diff.** The only two migrations that define
  `clinical_audit_row()` are `0004_clinical.sql` (original) and
  `0007_clinical_prescriptions.sql` (the replace). Isolating the
  `encounters` / `visit_notes` / `support_access_grants` conditional
  branches from both bodies and diffing them is byte-for-byte identical —
  same conditions, same columns, same values written to
  `clinical_access_log`. The only differences anywhere in the function are
  `CREATE FUNCTION` → `CREATE OR REPLACE FUNCTION` (the intentional
  widening) and the original branches' trailing `END IF;` being pushed
  down to make room for the new `prescriptions` `ELSIF` branches — the
  signature, the `DECLARE v_actor` line, and the `RETURN NEW; END; $$;`
  tail are also unchanged. 0007 does not re-create the `encounters_audit`
  or `visit_notes_audit` triggers; they still point at the same function
  by name and now execute the widened-but-compatible body. **No
  discrepancy found — `clinical_audit_row()` was not modified as part of
  this verification.**
- **Regression test.** `apps/api/test/clinical/audit-trigger-regression.test.ts`
  exercises all three clinical-tier tables in one fixture flow (an
  encounter created via the booking-completion path, a visit note added by
  the owning doctor, a prescription issued by the owning doctor) and
  asserts the resulting `clinical_access_log` rows against the exact shape
  the original Phase-5 gate asserted (`encounter.test.ts`'s
  `encounter_created`/`system:outbox` assertion, `notes.test.ts`'s
  `note_added`/doctor-actor assertion), plus the new
  `prescription_issued`/doctor-actor row, plus a combined check that all
  three rows exist with no id column cross-contamination. 4/4 tests
  passed.
- **Environment note.** Docker/Testcontainers is not installed in this
  WSL environment (no daemon socket, no `docker` binary), so
  `createTestDatabase()` resolved to its documented embedded-PG16
  fallback rather than a Testcontainers container — the same real
  PostgreSQL 16 major version the harness contract guarantees either way,
  and the same path every other test in this repo already runs on this
  machine. Testcontainers was not exercised in this verification pass.
