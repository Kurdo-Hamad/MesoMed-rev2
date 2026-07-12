/**
 * PushChannel adapter interface (MM-PLAN-001 §3.8, §5 Phase 7): Expo push
 * notifications. Mobile UI lands Phase 9; the token-registration procedure
 * and this send path are ready now so the communication module can prefer
 * push the moment a token exists (MM-DEC §6).
 */
export interface PushMessage {
  token: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

export class PushSendError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PushSendError";
  }
}

/** The device token is no longer registered (Expo `DeviceNotRegistered`) — caller should delete it. */
export class PushTokenInvalidError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PushTokenInvalidError";
  }
}

export interface PushChannel {
  /** Deliver a push notification. Rejects with PushTokenInvalidError or PushSendError. */
  send(message: PushMessage): Promise<void>;
}
