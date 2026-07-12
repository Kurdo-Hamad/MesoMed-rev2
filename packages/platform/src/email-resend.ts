/**
 * Resend email adapter (MM-PLAN-001 §5 Phase 7): generalized from the
 * Phase 2 verification-only usage to a full `EmailChannel` for
 * notification bodies. Vendor HTTP call isolated to this file (§3.8).
 */
import { EmailSendError, type EmailChannel, type EmailMessage } from "./email.js";

export interface ResendEmailAdapterOptions {
  apiKey: string;
  from: string;
  /** Resend API base URL; override in tests only. */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Request timeout in ms — bounds a stalled vendor connection (ADR-0011 F-3). */
  timeoutMs?: number;
}

const DEFAULT_BASE_URL = "https://api.resend.com";
const DEFAULT_TIMEOUT_MS = 10_000;

export function createResendEmailAdapter(options: ResendEmailAdapterOptions): EmailChannel {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async send(message: EmailMessage): Promise<void> {
      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}/emails`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            from: options.from,
            to: [message.to],
            subject: message.subject,
            text: message.text,
            html: message.html,
          }),
          signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        });
      } catch (error) {
        throw new EmailSendError("Resend request failed", { cause: error });
      }
      if (!response.ok) {
        // Never include the API key OR the destination in the error message
        // (ADR-0011 F-6) — this string can end up in notification_log.last_error,
        // a column with no crypto-shred scope; the row's own destination
        // column already identifies the target.
        throw new EmailSendError(`Resend API returned ${response.status}`);
      }
    },
  };
}
