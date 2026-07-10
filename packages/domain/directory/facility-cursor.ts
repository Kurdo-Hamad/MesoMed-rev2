/**
 * Provider module — opaque keyset cursor for facility listings (MM-EXEC-003).
 * Module Owner: Provider Team
 *
 * The cursor encodes the keyset triple of the stable landing sort
 * (tier_rank ASC, name_<locale> ASC, id ASC) as base64url JSON. It is opaque
 * to clients, Zod-validated on receipt, and a malformed or tampered cursor
 * decodes to null — the service then serves page one; it never throws and
 * never leaks an error shape (spec §5).
 */

import { z } from 'zod';

const cursorSchema = z.object({
  /** tier_rank of the last row served (1..3 today; wider kept for safety). */
  r: z.number().int().min(0).max(1000),
  /** Localized name of the last row served (keyset middle column). */
  n: z.string().max(500),
  /** id of the last row served (keyset tiebreaker). */
  i: z.string().uuid(),
});

export type FacilityCursor = z.infer<typeof cursorSchema>;

export function encodeFacilityCursor(cursor: FacilityCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeFacilityCursor(raw: string | null | undefined): FacilityCursor | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8')
    );
    const result = cursorSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
