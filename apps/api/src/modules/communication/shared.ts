/**
 * Channel router (MM-DEC §6, MM-PLAN-001 §5 Phase 7): push is primary
 * when a live device token exists and the user allows it; otherwise
 * WhatsApp is planned for a known phone (the sender falls back to SMS on
 * a failed WhatsApp attempt — same order as OTP delivery); email rides
 * alongside as a secondary channel whenever an address exists and is
 * allowed. Reads current contact/preference/token state at call time —
 * never from the triggering event's payload (ADR-0010 PII posture).
 */
import { desc, deviceTokens, eq, type DbExecutor } from "@mesomed/db";
import type { Locale } from "@mesomed/contracts/i18n";
import {
  DEFAULT_CHANNEL_PREFERENCES,
  type NotificationChannel,
} from "@mesomed/contracts/communication";
import { getPatientContact } from "../identity/queries/patient-contacts.js";
import { getChannelPreferences } from "./queries/channel-preferences.js";
import { resolveLocale } from "./templates.js";

export interface PlannedDelivery {
  channel: NotificationChannel;
  destination: string;
}

export interface DeliveryPlan {
  locale: Locale;
  deliveries: PlannedDelivery[];
}

export async function resolveDeliveryPlan(
  db: DbExecutor,
  input: { patientProfileId: string },
): Promise<DeliveryPlan> {
  const contact = await getPatientContact(db, input.patientProfileId);
  if (!contact) return { locale: resolveLocale(null), deliveries: [] };

  const prefs = contact.userId
    ? await getChannelPreferences(db, contact.userId)
    : DEFAULT_CHANNEL_PREFERENCES;
  const locale = resolveLocale(prefs.locale);

  const deliveries: PlannedDelivery[] = [];

  let primaryPlanned = false;
  if (contact.userId && prefs.pushEnabled) {
    const [token] = await db
      .select({ token: deviceTokens.token })
      .from(deviceTokens)
      .where(eq(deviceTokens.userId, contact.userId))
      .orderBy(desc(deviceTokens.lastSeenAt))
      .limit(1);
    if (token) {
      deliveries.push({ channel: "push", destination: token.token });
      primaryPlanned = true;
    }
  }
  if (!primaryPlanned && prefs.whatsappEnabled) {
    deliveries.push({ channel: "whatsapp", destination: contact.normalizedPhone });
  }
  if (contact.email && prefs.emailEnabled) {
    deliveries.push({ channel: "email", destination: contact.email });
  }

  return { locale, deliveries };
}
