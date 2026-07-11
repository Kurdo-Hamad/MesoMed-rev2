/**
 * Mock/log OTP provider (Phase 2 — MM-DEC rev02 §8). Records messages for
 * test inspection and can be armed to fail to exercise fallback logic.
 */
import { OtpSendError, type OtpChannel, type OtpChannelKind, type OtpMessage } from "./otp.js";

export interface MockOtpChannel extends OtpChannel {
  /** Messages successfully "delivered", in send order. */
  readonly sent: readonly OtpMessage[];
  /** While true, send() rejects with OtpSendError. */
  failing: boolean;
}

export function createMockOtpChannel(kind: OtpChannelKind): MockOtpChannel {
  const sent: OtpMessage[] = [];
  return {
    channel: kind,
    sent,
    failing: false,
    send(message: OtpMessage): Promise<void> {
      if (this.failing) {
        return Promise.reject(new OtpSendError(kind, `mock ${kind} channel armed to fail`));
      }
      sent.push(message);
      return Promise.resolve();
    },
  };
}
