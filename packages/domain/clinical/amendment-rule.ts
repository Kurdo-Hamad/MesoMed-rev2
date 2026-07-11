/**
 * Visit-note amendments model (MM-PLAN-001 §3.5): corrections are new rows
 * that reference the note they amend; content is never updated. Amendments
 * always target an ORIGINAL note — one-level chains keep history linear
 * and every amendment attributable to exactly one original.
 */

export interface AmendableNote {
  encounterId: string;
  /** Null when the note is an original; set when it is itself an amendment. */
  amendsNoteId: string | null;
}

export type AmendmentVerdict = { ok: true } | { ok: false; reason: "target_is_amendment" };

/** Whether a new amendment may target this note. */
export function validateAmendmentTarget(target: AmendableNote): AmendmentVerdict {
  if (target.amendsNoteId !== null) return { ok: false, reason: "target_is_amendment" };
  return { ok: true };
}
