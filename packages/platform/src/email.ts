/**
 * EmailChannel adapter interface (MM-PLAN-001 §3.8).
 *
 * Phase 2 ships a mock/log provider for provider email verification;
 * the real Resend adapter lands in Phase 7 behind this same interface.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export class EmailSendError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "EmailSendError";
  }
}

export interface EmailChannel {
  /** Deliver an email. Rejects with EmailSendError on delivery failure. */
  send(message: EmailMessage): Promise<void>;
}
