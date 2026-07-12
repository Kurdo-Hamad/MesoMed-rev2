/**
 * Mock/log push provider (Phase 7). Records messages for test inspection.
 */
import {
  PushSendError,
  PushTokenInvalidError,
  type PushChannel,
  type PushMessage,
} from "./push.js";

export interface MockPushChannel extends PushChannel {
  readonly isMock: true;
  readonly sent: readonly PushMessage[];
  /** While true, send() rejects with PushSendError. */
  failing: boolean;
  /** While true, send() rejects with PushTokenInvalidError (simulates a dead token). */
  tokenInvalid: boolean;
}

export function createMockPushChannel(): MockPushChannel {
  const sent: PushMessage[] = [];
  return {
    isMock: true,
    sent,
    failing: false,
    tokenInvalid: false,
    send(message: PushMessage): Promise<void> {
      if (this.tokenInvalid) {
        return Promise.reject(new PushTokenInvalidError("mock push channel armed: token invalid"));
      }
      if (this.failing) {
        return Promise.reject(new PushSendError("mock push channel armed to fail"));
      }
      sent.push(message);
      return Promise.resolve();
    },
  };
}
