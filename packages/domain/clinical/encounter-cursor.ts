/**
 * Opaque keyset cursor for encounter listings (MM-QA-004 F-12).
 *
 * The cursor encodes the keyset pair of the stable encounter sort
 * (starts_at DESC, id ASC) as base64url JSON — the same shape and
 * guarantees as the directory facility cursor: opaque to clients,
 * Zod-validated on receipt, and a malformed or tampered cursor decodes to
 * null so the service serves page one; it never throws and never leaks an
 * error shape.
 */

import { z } from "zod";

const cursorSchema = z.object({
  /** starts_at of the last row served (ISO instant, keyset lead column). */
  s: z.string().datetime(),
  /** id of the last row served (keyset tiebreaker). */
  i: z.string().uuid(),
});

export type EncounterCursor = z.infer<typeof cursorSchema>;

export function encodeEncounterCursor(cursor: EncounterCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeEncounterCursor(raw: string | null | undefined): EncounterCursor | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    const result = cursorSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
