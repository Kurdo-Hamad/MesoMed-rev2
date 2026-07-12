/**
 * Twilio SMS adapter (MM-PLAN-001 §5 Phase 7; MM-DEC rev02 §8): real
 * implementation behind `NotifyChannel` and `OtpChannel` — OTP fallback
 * when WhatsApp delivery fails, and the fallback notification channel for
 * guest bookings (MM-DEC §6). Vendor HTTP call isolated to this file (§3.8).
 */
import { NotifySendError, type NotifyChannel, type NotifyMessage } from "./notify.js";
import { OtpSendError, type OtpChannel, type OtpMessage } from "./otp.js";

export interface TwilioSmsAdapterOptions {
  accountSid: string;
  authToken: string;
  /** Twilio sender number (E.164) or messaging service SID. */
  from: string;
  /** Twilio API base URL; override in tests only. */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Request timeout in ms — bounds a stalled vendor connection (ADR-0011 F-3). */
  timeoutMs?: number;
}

export interface TwilioSmsAdapter {
  notify: NotifyChannel;
  otp: OtpChannel;
}

const DEFAULT_BASE_URL = "https://api.twilio.com";
const DEFAULT_TIMEOUT_MS = 10_000;

async function sendSms(options: TwilioSmsAdapterOptions, to: string, body: string): Promise<void> {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const fetchImpl = options.fetchImpl ?? fetch;
  const auth = Buffer.from(`${options.accountSid}:${options.authToken}`).toString("base64");
  const params = new URLSearchParams({ To: to, From: options.from, Body: body });
  const response = await fetchImpl(
    `${baseUrl}/2010-04-01/Accounts/${options.accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    },
  );
  if (!response.ok) {
    // Never include the auth token OR the destination in the error message
    // (ADR-0011 F-6) — this string can end up in notification_log.last_error,
    // a column with no crypto-shred scope; the row's own destination column
    // already identifies the target.
    throw new Error(`Twilio SMS API returned ${response.status}`);
  }
}

function renderOtpBody(message: OtpMessage, catalogText: string): string {
  return catalogText
    .split("{code}")
    .join(message.code)
    .split("{minutes}")
    .join(String(message.expiresInMinutes));
}

export function createTwilioSmsAdapter(
  options: TwilioSmsAdapterOptions,
  otpMessageCatalog: Record<string, string>,
): TwilioSmsAdapter {
  return {
    notify: {
      channel: "sms",
      async send(message: NotifyMessage): Promise<void> {
        try {
          await sendSms(options, message.to, message.body);
        } catch (error) {
          throw new NotifySendError("sms", "SMS send failed", { cause: error });
        }
      },
    },
    otp: {
      channel: "sms",
      async send(message: OtpMessage): Promise<void> {
        const catalogText = otpMessageCatalog[message.locale] ?? otpMessageCatalog.ckb ?? "{code}";
        try {
          await sendSms(options, message.to, renderOtpBody(message, catalogText));
        } catch (error) {
          throw new OtpSendError("sms", "SMS OTP send failed", { cause: error });
        }
      },
    },
  };
}
