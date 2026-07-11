/**
 * Communication module contracts (MM-PLAN-001 §5 Phase 7). Channel and
 * template identifiers are shared data: clients render preference UIs from
 * the channel list, and the notification log / metrics dimensions use the
 * same values — one vocabulary, no drift.
 */
import { z } from "zod";
import { LOCALES } from "./i18n.js";

export const NOTIFICATION_CHANNELS = ["push", "whatsapp", "sms", "email"] as const;

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_TEMPLATES = [
  "booking_confirmation",
  "reschedule_notice",
  "cancellation_notice",
  "reminder",
  "prescription_issued",
  "subscription_activated",
  "subscription_expired",
] as const;

export type NotificationTemplate = (typeof NOTIFICATION_TEMPLATES)[number];

/**
 * Lifecycle of one planned delivery in the notification log: `pending`
 * until the sender picks it up, then `sent`, `failed` (retries exhausted)
 * or `denied` (an abuse guardrail refused the send — never retried).
 */
export const NOTIFICATION_STATUSES = ["pending", "sent", "failed", "denied"] as const;

export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const DEVICE_PLATFORMS = ["ios", "android"] as const;

export const registerDeviceTokenInputSchema = z.object({
  /** Expo push token as issued by the Expo SDK on the device. */
  token: z.string().min(1).max(4096),
  platform: z.enum(DEVICE_PLATFORMS),
});

export const registerDeviceTokenOutputSchema = z.object({
  deviceTokenId: z.string(),
});

export const channelPreferencesSchema = z.object({
  pushEnabled: z.boolean(),
  whatsappEnabled: z.boolean(),
  smsEnabled: z.boolean(),
  emailEnabled: z.boolean(),
  /** Preferred notification locale; null = platform default (ckb). */
  locale: z.enum(LOCALES).nullable(),
});

export type ChannelPreferences = z.infer<typeof channelPreferencesSchema>;

/** All-true, default-locale preferences applied when no row exists. */
export const DEFAULT_CHANNEL_PREFERENCES: ChannelPreferences = {
  pushEnabled: true,
  whatsappEnabled: true,
  smsEnabled: true,
  emailEnabled: true,
  locale: null,
};

export const setChannelPreferencesInputSchema = channelPreferencesSchema.partial();

export const setChannelPreferencesOutputSchema = channelPreferencesSchema;
