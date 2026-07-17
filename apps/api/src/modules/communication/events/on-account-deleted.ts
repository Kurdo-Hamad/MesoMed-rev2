/**
 * Account-deleted subscriber (MM-QA-004 F-02): when identity erases an
 * account, communication hard-deletes that subject's notification_log rows
 * — its only persisted PII for the subject (destination, params). The
 * event is id-only; the delete keys off those ids. Exactly-once by the
 * dispatcher's transaction (convention #1: communication owns this table).
 */
import type { accountDeletedV1, accountDeletedV2, EventEnvelope } from "@mesomed/contracts";
import type { EventHandlerFn } from "../../../kernel/events.js";
import { deleteSubjectNotifications } from "../commands/delete-subject-notifications.js";

export const ON_ACCOUNT_DELETED_HANDLER = "communication.erase-subject-notifications";

/** Registered for v1 AND v2 — same prune, keyed on the ids both carry
 * (v1 handlers are kept until drained, convention #3). */
export const onAccountDeleted: EventHandlerFn = async (envelope, tx) => {
  const { payload } = envelope as EventEnvelope<typeof accountDeletedV1 | typeof accountDeletedV2>;
  await deleteSubjectNotifications(tx, {
    userId: payload.userId,
    patientProfileId: payload.patientProfileId,
  });
};
