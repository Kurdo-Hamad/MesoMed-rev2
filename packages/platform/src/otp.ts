/**
 * OtpChannel adapter interface (MM-PLAN-001 §3.8, MM-DEC rev02 §8).
 *
 * One implementation per transport (WhatsApp, SMS). Channel-order policy
 * (WhatsApp-first, SMS-fallback) lives in the identity module, not here.
 * Phase 2 ships mock providers only; the real Meta WhatsApp Cloud API and
 * SMS providers land in Phase 7 behind this same interface.
 */
import type { Locale } from "@mesomed/contracts";

export type OtpChannelKind = "whatsapp" | "sms";

export interface OtpMessage {
  /** E.164 phone number. */
  to: string;
  code: string;
  locale: Locale;
}

export class OtpSendError extends Error {
  readonly channel: OtpChannelKind;

  constructor(channel: OtpChannelKind, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "OtpSendError";
    this.channel = channel;
  }
}

export interface OtpChannel {
  readonly channel: OtpChannelKind;
  /** Deliver an OTP message. Rejects with OtpSendError on delivery failure. */
  send(message: OtpMessage): Promise<void>;
}
