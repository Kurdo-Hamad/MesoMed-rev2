/**
 * Clinical module event contracts (MM-PLAN-001 §5 Phase 5). Versioned and
 * additive-only per §3.3.
 *
 * Privacy invariant: clinical event payloads carry identifiers only — never
 * visit-note content. `domain_events` is kernel infrastructure readable by
 * ops tooling and future subscribers; note content stays in `visit_notes`,
 * reachable only through the audited SECURITY DEFINER channel (§3.5/§3.6).
 */
import { z } from "zod";
import { defineEvent } from "./index.js";

export const encounterCreatedV1 = defineEvent(
  "clinical",
  "encounter_created",
  1,
  z.object({
    encounterId: z.string(),
    appointmentId: z.string(),
    doctorProfileId: z.string(),
    patientProfileId: z.string(),
    /** UTC instants as ISO strings — snapshot of the completed appointment. */
    startsAt: z.string(),
    endsAt: z.string(),
  }),
);

export const visitNoteAddedV1 = defineEvent(
  "clinical",
  "visit_note_added",
  1,
  z.object({
    visitNoteId: z.string(),
    encounterId: z.string(),
    authorUserId: z.string(),
    /** Set when this note amends an original — the amendments model (§3.5). */
    amendsNoteId: z.string().nullable(),
  }),
);

export const supportAccessGrantedV1 = defineEvent(
  "clinical",
  "support_access_granted",
  1,
  z.object({
    grantId: z.string(),
    encounterId: z.string(),
    adminUserId: z.string(),
    grantedBy: z.string(),
    reason: z.string(),
    expiresAt: z.string(),
  }),
);

export const supportAccessRevokedV1 = defineEvent(
  "clinical",
  "support_access_revoked",
  1,
  z.object({
    grantId: z.string(),
    encounterId: z.string(),
    revokedBy: z.string(),
  }),
);

// ── Prescriptions (clinical extension, ADR-0010) ───────────────────────
// Same privacy invariant as visit notes: ids only, never medication
// content. Phase 7 communication subscribes to these (MM-DEC §6); no
// subscriber exists in this slice.

export const prescriptionIssuedV1 = defineEvent(
  "clinical",
  "prescription_issued",
  1,
  z.object({
    prescriptionId: z.string(),
    encounterId: z.string(),
    doctorProfileId: z.string(),
    patientProfileId: z.string(),
  }),
);

export const prescriptionAmendedV1 = defineEvent(
  "clinical",
  "prescription_amended",
  1,
  z.object({
    prescriptionId: z.string(),
    encounterId: z.string(),
    doctorProfileId: z.string(),
    patientProfileId: z.string(),
    /** The revision this one supersedes — flipped to superseded in the same tx. */
    supersedesPrescriptionId: z.string(),
  }),
);

export const prescriptionDiscontinuedV1 = defineEvent(
  "clinical",
  "prescription_discontinued",
  1,
  z.object({
    prescriptionId: z.string(),
    encounterId: z.string(),
    doctorProfileId: z.string(),
    patientProfileId: z.string(),
  }),
);

/** All clinical event contracts, for registry composition in the API. */
export const CLINICAL_EVENTS = [
  encounterCreatedV1,
  visitNoteAddedV1,
  supportAccessGrantedV1,
  supportAccessRevokedV1,
  prescriptionIssuedV1,
  prescriptionAmendedV1,
  prescriptionDiscontinuedV1,
] as const;
