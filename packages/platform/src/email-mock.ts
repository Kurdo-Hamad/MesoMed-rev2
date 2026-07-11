/**
 * Mock/log email provider (Phase 2). Records messages for test inspection.
 */
import { EmailSendError, type EmailChannel, type EmailMessage } from "./email.js";

export interface MockEmailChannel extends EmailChannel {
  readonly isMock: true;
  /** Messages successfully "delivered", in send order. */
  readonly sent: readonly EmailMessage[];
  /** While true, send() rejects with EmailSendError. */
  failing: boolean;
}

export function createMockEmailChannel(): MockEmailChannel {
  const sent: EmailMessage[] = [];
  return {
    isMock: true,
    sent,
    failing: false,
    send(message: EmailMessage): Promise<void> {
      if (this.failing) {
        return Promise.reject(new EmailSendError("mock email channel armed to fail"));
      }
      sent.push(message);
      return Promise.resolve();
    },
  };
}
