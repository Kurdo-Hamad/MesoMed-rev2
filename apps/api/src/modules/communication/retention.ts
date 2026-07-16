/**
 * notification_log retention prune (Phase 10 Slice 6, ADR-0028): the log
 * carries the module's only persisted PII (destination, params_json,
 * appointment_id — crypto-shred scope, 12–24 month retention, ADR-0011).
 * This prune closes ADR-0011's "no retention job built yet" carry-over:
 * rows older than the window are deleted outright — a hard delete IS the
 * erasure action here, no crypto-shred machinery needed for expiry.
 * All statuses are pruned: a pending row older than the window is stuck
 * garbage that must not survive its own retention policy.
 */
import { lt, notificationLog, type Db } from "@mesomed/db";

export async function pruneNotificationLog(db: Db, retentionDays: number): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const deleted = await db
    .delete(notificationLog)
    .where(lt(notificationLog.createdAt, cutoff))
    .returning({ id: notificationLog.id });
  return deleted.length;
}
