/**
 * Meta WhatsApp Cloud API adapter (MM-PLAN-001 §5 Phase 7; MM-DEC rev02
 * §8, §9): real implementation behind the `NotifyChannel` and `OtpChannel`
 * interfaces, replacing the Phase 2 mock. Used for patient-registration
 * OTP, account recovery, guest booking notifications, and the walk-in
 * install-link message.
 *
 * Vendor HTTP call is isolated to this file (§3.8) — module code never
 * imports the Meta Graph API shape directly.
 */
import { NotifySendError, type NotifyChannel, type NotifyMessage } from "./notify.js";
import { OtpSendError, type OtpChannel, type OtpMessage } from "./otp.js";

export interface MetaWhatsAppAdapterOptions {
  accessToken: string;
  phoneNumberId: string;
  /** Meta Graph API base URL; override in tests only. */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Request timeout in ms — bounds a stalled vendor connection (ADR-0011 F-3). */
  timeoutMs?: number;
}

export interface MetaWhatsAppAdapter {
  notify: NotifyChannel;
  otp: OtpChannel;
}

const DEFAULT_BASE_URL = "https://graph.facebook.com/v20.0";
/**
 * Default request timeout (ADR-0011 F-3): with none set, a stalled vendor
 * connection could hang for undici's default (~minutes) — in the OTP path
 * that hangs an interactive registration request, and in the notification
 * sender it can outlast the batch claim window (see sender.ts CLAIM_HOLD_MS).
 */
const DEFAULT_TIMEOUT_MS = 10_000;

async function sendText(
  options: MetaWhatsAppAdapterOptions,
  to: string,
  body: string,
): Promise<void> {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${baseUrl}/${options.phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body },
    }),
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
  if (!response.ok) {
    // Never include the access token OR the destination in the error message
    // (ADR-0011 F-6) — this string can end up in notification_log.last_error,
    // a column with no crypto-shred scope; the row's own destination column
    // already identifies the target.
    throw new Error(`Meta WhatsApp Cloud API returned ${response.status}`);
  }
}

/** OTP message body per locale, ported from packages/i18n `identity.otp.message`. */
function renderOtpBody(message: OtpMessage, catalogText: string): string {
  return catalogText
    .split("{code}")
    .join(message.code)
    .split("{minutes}")
    .join(String(message.expiresInMinutes));
}

export function createMetaWhatsAppAdapter(
  options: MetaWhatsAppAdapterOptions,
  otpMessageCatalog: Record<string, string>,
): MetaWhatsAppAdapter {
  return {
    notify: {
      channel: "whatsapp",
      async send(message: NotifyMessage): Promise<void> {
        try {
          await sendText(options, message.to, message.body);
        } catch (error) {
          throw new NotifySendError("whatsapp", "WhatsApp send failed", { cause: error });
        }
      },
    },
    otp: {
      channel: "whatsapp",
      async send(message: OtpMessage): Promise<void> {
        const catalogText = otpMessageCatalog[message.locale] ?? otpMessageCatalog.ckb ?? "{code}";
        try {
          await sendText(options, message.to, renderOtpBody(message, catalogText));
        } catch (error) {
          throw new OtpSendError("whatsapp", "WhatsApp OTP send failed", { cause: error });
        }
      },
    },
  };
}
