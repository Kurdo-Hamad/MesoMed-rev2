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

export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

export const registerDeviceTokenInputSchema = z.object({
  /** Expo push token as issued by the Expo SDK on the device. */
  token: z.string().min(1).max(4096),
  platform: z.enum(DEVICE_PLATFORMS),
});

export const registerDeviceTokenOutputSchema = z.object({
  deviceTokenId: z.string(),
});

/** ADR-0011 F-9: a device logging out should stop receiving push there. */
export const unregisterDeviceTokenInputSchema = z.object({
  token: z.string().min(1).max(4096),
});

export const unregisterDeviceTokenOutputSchema = z.object({
  /** False when the token was already gone or never belonged to this caller — still a success (idempotent). */
  unregistered: z.boolean(),
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

/**
 * Ops-facing recent-deliveries feed (ADR-0011 F-14): status/channel/template
 * only — deliberately excludes `destination`/`paramsJson` (PII), so this is
 * safe as an admin-only read, distinct from the clinical-style
 * support-grant-gated PII access pattern.
 */
export const listRecentNotificationsInputSchema = z.object({
  limit: z.number().int().min(1).max(200).optional(),
});

export const notificationFeedEntrySchema = z.object({
  id: z.string(),
  template: z.enum(NOTIFICATION_TEMPLATES),
  channel: z.enum(NOTIFICATION_CHANNELS),
  status: z.enum(NOTIFICATION_STATUSES),
  attempts: z.number().int(),
  createdAt: z.iso.datetime(),
});

export const listRecentNotificationsOutputSchema = z.array(notificationFeedEntrySchema);
