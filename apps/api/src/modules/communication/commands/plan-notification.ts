/**
 * Notification planning (MM-PLAN-001 §5 Phase 7): inserts `pending`
 * `notification_log` rows inside the caller's transaction — for an event
 * subscriber that is the same transaction its idempotency claim was made
 * on, so planning is exactly-once by construction (§3.2). `dedupeKey`
 * additionally makes replanning (e.g. an outbox redelivery) a no-op.
 *
 * Channel + destination are resolved here, at plan time, via
 * `resolveDeliveryPlan`'s published-query reads — never copied from the
 * triggering event's payload, which carries identifiers only (ADR-0010
 * PII posture). Freshness beyond this point (a token or address changing
 * between planning and the sender's actual delivery attempt) is bounded
 * by the sender's poll interval, not by a second re-read.
 *
 * `occurrenceKey` (ADR-0011 dedupe redesign) identifies WHICH occurrence of
 * `template` this is — distinct from `appointmentId`/`patientProfileId`,
 * which merely identify the aggregate the notification is about. Keying
 * dedup on the aggregate alone (the original design) meant a second
 * prescription, a second reschedule, or a second subscription-renewal
 * cycle for the SAME aggregate silently planned nothing — `ON CONFLICT DO
 * NOTHING` treated it as a redelivery of the first one. Callers pass the
 * triggering domain event's id (stable across redeliveries of the SAME
 * event, distinct for every NEW event) or, for the non-event-driven
 * reminder cron, a natural key that changes when the underlying fact does
 * (appointment id + its current start time).
 */
import { notificationLog, type DbExecutor } from "@mesomed/db";
import type { Locale } from "@mesomed/contracts/i18n";
import type { NotificationTemplate } from "@mesomed/contracts/communication";
import { resolveDeliveryPlan } from "../shared.js";

export interface PlanNotificationInput {
  patientProfileId: string;
  /** Cross-module reference (booking) — null for non-appointment templates. */
  appointmentId?: string | null;
  template: NotificationTemplate;
  /** Uniquely identifies this notification OCCURRENCE — see module doc. */
  occurrenceKey: string;
  /**
   * Builds the render params once the recipient's locale is known — a
   * trilingual display name (doctor/location) must be picked in the SAME
   * locale the message body itself renders in, so callers defer that
   * choice to here instead of picking a name before the plan resolves.
   */
  buildParams: (locale: Locale) => Record<string, string>;
}

/**
 * Plans every channel `resolveDeliveryPlan` selects for this patient. A
 * patient with no contactable channel plans nothing — not an error, since
 * a guest profile mid-claim or a fully opted-out user is a normal state.
 */
export async function planNotification(
  db: DbExecutor,
  input: PlanNotificationInput,
): Promise<void> {
  const plan = await resolveDeliveryPlan(db, { patientProfileId: input.patientProfileId });
  if (plan.deliveries.length === 0) return;

  const paramsJson = JSON.stringify(input.buildParams(plan.locale));

  for (const delivery of plan.deliveries) {
    await db
      .insert(notificationLog)
      .values({
        patientProfileId: input.patientProfileId,
        appointmentId: input.appointmentId ?? null,
        template: input.template,
        channel: delivery.channel,
        destination: delivery.destination,
        locale: plan.locale,
        paramsJson,
        dedupeKey: `${input.template}:${input.occurrenceKey}:${delivery.channel}`,
      })
      .onConflictDoNothing({ target: notificationLog.dedupeKey });
  }
}
