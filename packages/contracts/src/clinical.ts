/**
 * Clinical module API contracts (MM-PLAN-001 §5 Phase 5). Router I/O is
 * typed here so web/mobile share one source of truth (§3.11/§3.12).
 *
 * Instants on the wire are ISO strings (UTC). Visit-note content crosses
 * the wire only in these procedure outputs — never in event payloads.
 */
import { z } from "zod";

export const encounterSchema = z.object({
  encounterId: z.string(),
  appointmentId: z.string(),
  doctorProfileId: z.string(),
  patientProfileId: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  createdAt: z.string(),
});

export const listEncountersOutputSchema = z.object({
  encounters: z.array(encounterSchema),
});

export const encounterIdInputSchema = z.object({ encounterId: z.string().uuid() });

export const visitNoteSchema = z.object({
  visitNoteId: z.string(),
  encounterId: z.string(),
  /** Null on an original note; the amended note's id on an amendment. */
  amendsNoteId: z.string().nullable(),
  authorUserId: z.string(),
  content: z.string(),
  createdAt: z.string(),
});

/** Notes of one encounter in creation order: originals with their amendments. */
export const visitNotesOutputSchema = z.object({
  encounterId: z.string(),
  notes: z.array(visitNoteSchema),
});

export const addVisitNoteInputSchema = z.object({
  encounterId: z.string().uuid(),
  content: z.string().min(1).max(20_000),
});

export const amendVisitNoteInputSchema = z.object({
  encounterId: z.string().uuid(),
  /** The ORIGINAL note being corrected — amendments never chain (§3.5). */
  visitNoteId: z.string().uuid(),
  content: z.string().min(1).max(20_000),
});

export const visitNoteResultSchema = z.object({
  visitNoteId: z.string(),
  encounterId: z.string(),
  amendsNoteId: z.string().nullable(),
});

// ── Support access (time-boxed admin grants, §3.5) ─────────────────────

export const grantSupportAccessInputSchema = z.object({
  encounterId: z.string().uuid(),
  /** Why support needs clinical access — mandatory, lands in the audit log. */
  reason: z.string().min(5).max(1_000),
  /** ISO instant; must be in the future and within the policy window. */
  expiresAt: z.iso.datetime(),
});

export const supportGrantSchema = z.object({
  grantId: z.string(),
  encounterId: z.string(),
  adminUserId: z.string(),
  grantedBy: z.string(),
  reason: z.string(),
  expiresAt: z.string(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
});

export const grantSupportAccessResultSchema = z.object({
  grantId: z.string(),
  encounterId: z.string(),
  expiresAt: z.string(),
});

export const grantIdInputSchema = z.object({ grantId: z.string().uuid() });

export const revokeSupportAccessResultSchema = z.object({
  grantId: z.string(),
  /** False when the grant was already revoked (idempotent revoke). */
  revoked: z.boolean(),
});

export const listSupportGrantsInputSchema = z.object({
  encounterId: z.string().uuid().optional(),
});

export const listSupportGrantsOutputSchema = z.object({
  grants: z.array(supportGrantSchema),
});
