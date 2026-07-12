/**
 * Device-token unregistration (ADR-0011 F-9): a user logging out on a
 * device should stop receiving push there — no unregister path existed
 * previously, so a discarded or shared device kept receiving pushes
 * (including a bare `prescription_issued` notice, which carries no
 * medication content but whose mere existence is sensitive) after logout.
 * Deletes the row only when it belongs to the calling session (own-row-only,
 * §3.6 layer b) — an unowned or already-gone token is a silent success:
 * logout must never error on a stale token.
 */
import { and, deviceTokens, eq, type DbExecutor } from "@mesomed/db";

export async function unregisterDeviceToken(
  db: DbExecutor,
  userId: string,
  input: { token: string },
): Promise<{ unregistered: boolean }> {
  const deleted = await db
    .delete(deviceTokens)
    .where(and(eq(deviceTokens.token, input.token), eq(deviceTokens.userId, userId)))
    .returning({ id: deviceTokens.id });
  return { unregistered: deleted.length > 0 };
}
