/**
 * Expo Push adapter (MM-PLAN-001 §5 Phase 7): real implementation behind
 * `PushChannel`. Vendor HTTP call isolated to this file (§3.8).
 */
import { PushSendError, PushTokenInvalidError, type PushChannel, type PushMessage } from "./push.js";

export interface ExpoPushAdapterOptions {
  /** Expo access token (optional — required only for Expo push security). */
  accessToken?: string;
  /** Expo push API base URL; override in tests only. */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface ExpoTicket {
  status: "ok" | "error";
  message?: string;
  details?: { error?: string };
}

const DEFAULT_BASE_URL = "https://exp.host/--/api/v2/push/send";

export function createExpoPushAdapter(options: ExpoPushAdapterOptions = {}): PushChannel {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async send(message: PushMessage): Promise<void> {
      let response: Response;
      try {
        response = await fetchImpl(baseUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
          },
          body: JSON.stringify({
            to: message.token,
            title: message.title,
            body: message.body,
            data: message.data,
          }),
        });
      } catch (error) {
        throw new PushSendError("Expo push request failed", { cause: error });
      }

      if (!response.ok) {
        throw new PushSendError(`Expo push API returned ${response.status}`);
      }

      const payload = (await response.json()) as { data?: ExpoTicket };
      const ticket = payload.data;
      if (ticket?.status === "error") {
        if (ticket.details?.error === "DeviceNotRegistered") {
          throw new PushTokenInvalidError(`Expo token no longer registered: ${message.token}`);
        }
        throw new PushSendError(ticket.message ?? "Expo push ticket reported an error");
      }
    },
  };
}
