# ADR-0014 — Soft-Delete / Deactivation Semantics

**Status:** Accepted
**Phase:** 8 (obligation per MM-ARC-002 §9.4, restated in the Phase 8
kickoff instruction).
**Builds on:** ADR-0007 (clinical append-only + audit trigger), ADR-0010
(patient-authored data, hard-delete precedent), convention #5.

## Decision: three regimes, no generic `deleted_at`

There is deliberately **no platform-wide soft-delete convention**. Each
data class has exactly one deletion regime, chosen by what the data is:

1. **Clinical data is never deleted.** Encounters, visit notes,
   prescriptions, and the `clinical_access_log` are append-only;
   corrections are amendments (new rows linked to what they supersede —
   ADR-0007/ADR-0010, convention #5). Regulatory erasure requests are
   satisfied by **crypto-shredding** when at-rest encryption of clinical
   PII lands: destroy the per-patient key, rendering rows unreadable
   without touching row history. Until then, erasure requests are handled
   operationally and logged; rows are still never UPDATEd or DELETEd.

2. **Directory and config rows are deactivated, never deleted.** Cities,
   categories, specialties, symptoms, procedures, facilities, doctor
   profiles, locations, tiers, and config entries carry `active` flags (or
   gating status rows) that remove them from every public read path while
   preserving referential integrity for history that points at them
   (appointments at a closed clinic, payments for a retired tier).
   Deactivation is reversible by design; nothing in the platform depends
   on a directory row's absence.

3. **Patient-authored non-clinical data may hard-delete.** The ADR-0010
   precedent stands: patient-reported medications (and the medical-profile
   fields the patient owns) are the patient's own statements, not
   clinician records — `removeReportedMedication` issues a real DELETE.
   Reads that join into them must tolerate absence (e.g.
   `booking.clinicDay` answers `patientName: null` when the profile is
   gone).

## Why no generic `deleted_at`

A single soft-delete column pretends the three regimes above are one
problem. It would silently weaken the clinical guarantee (a "deleted" note
is still a mutation of record state), complicate every directory query with
`WHERE deleted_at IS NULL` while the `active` flag already carries the
semantics, and forbid the hard-deletes the patient-data regime requires.
Each regime is enforced where it lives: the DB trigger + RLS for clinical,
the published-query layer for directory, and ordinary DELETEs for
patient-authored rows.
