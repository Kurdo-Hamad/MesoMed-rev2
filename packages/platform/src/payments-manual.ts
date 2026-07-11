/**
 * The `manual` payment gateway (MM-PLAN-001 §5 Phase 6) — the launch
 * gateway. There is no external processor: an admin records that payment
 * was received out of band (cash, bank transfer), so initiation settles
 * synchronously and verification affirms any reference this adapter
 * issued. It has no webhook channel — deliveries addressed to it are
 * rejected, not silently accepted (§3.11: typed failures, no ambiguity).
 */
import {
  WebhookUnsupportedError,
  type PaymentGateway,
  type PaymentInitiation,
  type PaymentVerification,
} from "./payments.js";

export const MANUAL_GATEWAY_ID = "manual";

const REFERENCE_PREFIX = `${MANUAL_GATEWAY_ID}:`;

export function createManualPaymentGateway(): PaymentGateway {
  return {
    id: MANUAL_GATEWAY_ID,

    // Nothing to configure: recording is an authenticated admin action.
    isConfigured: () => true,

    async initiatePayment(input): Promise<PaymentInitiation> {
      return {
        // Deterministic per idempotency key: a retried recording produces
        // the same reference, so replay detection stays with the caller's
        // unique-key constraint rather than diverging references.
        reference: `${REFERENCE_PREFIX}${input.idempotencyKey}`,
        status: "settled",
        redirectUrl: null,
      };
    },

    async verifyPayment(reference): Promise<PaymentVerification> {
      return {
        reference,
        // Only references this adapter minted verify as settled; anything
        // else is unknown to the manual channel and fails verification.
        status: reference.startsWith(REFERENCE_PREFIX) ? "settled" : "failed",
      };
    },

    async handleWebhook(): Promise<never> {
      throw new WebhookUnsupportedError(MANUAL_GATEWAY_ID);
    },
  };
}
