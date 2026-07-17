/**
 * Erase a subject's notification_log rows (MM-QA-004 F-02, retention
 * runbook §1: notification_log is "hard-delete rows for the subject").
 * Called by the account-deleted subscriber inside the dispatcher's
 * transaction, so the delete is exactly-once with the event's idempotency
 * claim. Keyed by user id and/or patient-profile id — a subject may have
 * account-holder rows (user id) and guest-era rows (profile id).
 */
import { eq, notificationLog, or, type DbTransaction } from "@mesomed/db";

export async function deleteSubjectNotifications(
  tx: DbTransaction,
  subject: { userId: string; patientProfileId: string | null },
): Promise<number> {
  const match =
    subject.patientProfileId === null
      ? eq(notificationLog.userId, subject.userId)
      : or(
          eq(notificationLog.userId, subject.userId),
          eq(notificationLog.patientProfileId, subject.patientProfileId),
        );
  const deleted = await tx.delete(notificationLog).where(match).returning({
    id: notificationLog.id,
  });
  return deleted.length;
}
