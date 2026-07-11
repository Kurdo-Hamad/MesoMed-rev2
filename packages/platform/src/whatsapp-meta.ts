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
}

export interface MetaWhatsAppAdapter {
  notify: NotifyChannel;
  otp: OtpChannel;
}

const DEFAULT_BASE_URL = "https://graph.facebook.com/v20.0";

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
  });
  if (!response.ok) {
    // Never include the access token in the error — only the destination and status.
    throw new Error(`Meta WhatsApp Cloud API returned ${response.status} for ${to}`);
  }
}

/** OTP message body per locale, ported from packages/i18n `identity.otp.message`. */
function renderOtpBody(message: OtpMessage, catalogText: string): string {
  return catalogText.split("{code}").join(message.code).split("{minutes}").join("10");
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
