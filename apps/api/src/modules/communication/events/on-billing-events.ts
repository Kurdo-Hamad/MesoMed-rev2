/**
 * Billing-event subscribers (MM-PLAN-001 §5 Phase 7): provider-facing
 * subscription notices. These are account-holder notifications (the
 * provider, not a patient), so they bypass the patient-scoped
 * `resolveDeliveryPlan`/`planNotification` and plan a direct email row —
 * email is the provider's account channel; there is no provider phone
 * OTP-equivalent to prefer here.
 */
import type {
  EventEnvelope,
  subscriptionActivatedV1,
  subscriptionExpiredV1,
} from "@mesomed/contracts";
import { notificationLog, type DbTransaction } from "@mesomed/db/modules/communication";
import type { EventHandlerFn } from "../../../kernel/events.js";
import { getIdentityProviderProfileIdForDoctorProfile } from "../../directory/queries/doctor-display-names.js";
import { getProviderContact } from "../../identity/queries/provider-contacts.js";
import { getChannelPreferences } from "../queries/channel-preferences.js";
import { resolveLocale } from "../templates.js";

export const ON_SUBSCRIPTION_ACTIVATED_HANDLER = "communication.plan-subscription-activated";
export const ON_SUBSCRIPTION_EXPIRED_HANDLER = "communication.plan-subscription-expired";

export const onSubscriptionActivated: EventHandlerFn = async (envelope, tx, eventId) => {
  const { payload } = envelope as EventEnvelope<typeof subscriptionActivatedV1>;
  await planProviderEmail(tx, payload.doctorProfileId, "subscription_activated", eventId);
};

export const onSubscriptionExpired: EventHandlerFn = async (envelope, tx, eventId) => {
  const { payload } = envelope as EventEnvelope<typeof subscriptionExpiredV1>;
  await planProviderEmail(tx, payload.doctorProfileId, "subscription_expired", eventId);
};

async function planProviderEmail(
  tx: DbTransaction,
  doctorProfileId: string,
  template: "subscription_activated" | "subscription_expired",
  eventId: string,
): Promise<void> {
  const providerProfileId = await getIdentityProviderProfileIdForDoctorProfile(tx, doctorProfileId);
  if (!providerProfileId) return;
  const contact = await getProviderContact(tx, providerProfileId);
  if (!contact) return;

  const prefs = await getChannelPreferences(tx, contact.userId);
  if (!prefs.emailEnabled) return;
  const locale = resolveLocale(prefs.locale);

  await tx
    .insert(notificationLog)
    .values({
      userId: contact.userId,
      template,
      channel: "email",
      destination: contact.email,
      locale,
      paramsJson: JSON.stringify({}),
      // The triggering event's own id — see ADR-0011 F-1. The old key used
      // `subscriptionId`, a stable per-doctor aggregate row: EVERY renewal
      // (a fresh `subscription_activated.v1`) collided on the first one,
      // and a second lapse never re-warned the provider.
      dedupeKey: `${template}:${eventId}:email`,
    })
    .onConflictDoNothing({ target: notificationLog.dedupeKey });
}
