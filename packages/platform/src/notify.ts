/**
 * NotifyChannel adapter interface (MM-PLAN-001 §3.8, §5 Phase 7): a
 * one-way text message to a phone number over WhatsApp or SMS. Distinct
 * from `OtpChannel` (identity module, code delivery) even though Phase 7
 * wires both transports through the same Meta/Twilio adapters — this
 * interface carries an arbitrary rendered body, never a code.
 */
export type NotifyChannelKind = "whatsapp" | "sms";

export interface NotifyMessage {
  /** E.164 phone number. */
  to: string;
  body: string;
}

export class NotifySendError extends Error {
  readonly channel: NotifyChannelKind;

  constructor(channel: NotifyChannelKind, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "NotifySendError";
    this.channel = channel;
  }
}

export interface NotifyChannel {
  readonly channel: NotifyChannelKind;
  /** Deliver a notification message. Rejects with NotifySendError on delivery failure. */
  send(message: NotifyMessage): Promise<void>;
}
