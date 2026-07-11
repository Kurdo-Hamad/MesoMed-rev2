/**
 * Mock/log notify provider (Phase 7). Records messages for test inspection.
 */
import { NotifySendError, type NotifyChannel, type NotifyChannelKind, type NotifyMessage } from "./notify.js";

export interface MockNotifyChannel extends NotifyChannel {
  readonly isMock: true;
  /** Messages successfully "delivered", in send order. */
  readonly sent: readonly NotifyMessage[];
  /** While true, send() rejects with NotifySendError. */
  failing: boolean;
}

export function createMockNotifyChannel(kind: NotifyChannelKind): MockNotifyChannel {
  const sent: NotifyMessage[] = [];
  return {
    channel: kind,
    isMock: true,
    sent,
    failing: false,
    send(message: NotifyMessage): Promise<void> {
      if (this.failing) {
        return Promise.reject(new NotifySendError(kind, `mock ${kind} channel armed to fail`));
      }
      sent.push(message);
      return Promise.resolve();
    },
  };
}
