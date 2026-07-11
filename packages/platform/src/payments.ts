/**
 * Payment gateway adapter interface (MM-PLAN-001 §3.8, §5 Phase 6).
 * Module code imports THIS interface only; concrete adapters are wired in
 * the apps/api composition root and selected per request through the
 * payment-routing config (packages/config, §3.9) — never hardcoded.
 *
 * Adapter roster at launch: `manual` (complete, below). FIB and ZainCash
 * are interface-ready — the routing config accepts their ids and this
 * interface is what they implement — but their adapters are deferred until
 * the integrations are real (§8: never speculatively).
 */
import type { PaymentKind } from "@mesomed/contracts/billing";

export type PaymentStatus = "settled" | "pending" | "failed";

export interface PaymentInitiationInput {
  /** Replay identity — the same key must never settle twice. */
  idempotencyKey: string;
  kind: PaymentKind;
  /** Whole currency units (ISO 4217 code alongside). */
  amount: number;
  currency: string;
  /** Free-form context for provider dashboards/reconciliation. */
  description: string;
}

export interface PaymentInitiation {
  /** Gateway-scoped payment reference for verification/reconciliation. */
  reference: string;
  status: PaymentStatus;
  /** Where to send the payer, for gateways with a hosted checkout. */
  redirectUrl: string | null;
}

export interface PaymentVerification {
  reference: string;
  status: PaymentStatus;
}

export interface WebhookInput {
  /** Exact bytes the gateway signed — signatures never verify re-serialized JSON. */
  rawBody: string;
  headers: Record<string, string | string[] | undefined>;
}

/**
 * A gateway-verified, platform-normalized payment notification. Producing
 * one asserts the webhook's signature was checked against the gateway's
 * scheme — `handleWebhook` throws `WebhookVerificationError` otherwise.
 */
export interface PaymentNotification {
  idempotencyKey: string;
  reference: string;
  kind: PaymentKind;
  amount: number;
  currency: string;
  periods: number;
  /** Set when kind = tier_payment. */
  facilityId?: string;
  tierKey?: string;
  /** Set when kind = subscription. */
  doctorProfileId?: string;
}

/** The webhook's signature is missing or does not verify. */
export class WebhookVerificationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "WebhookVerificationError";
  }
}

/** The gateway has no webhook channel (e.g. `manual`). */
export class WebhookUnsupportedError extends Error {
  constructor(gatewayId: string) {
    super(`Gateway "${gatewayId}" does not accept webhooks`);
    this.name = "WebhookUnsupportedError";
  }
}

export interface PaymentGateway {
  /** Stable id the routing config and webhook URLs address (e.g. "manual"). */
  readonly id: string;
  /** False until the deployment provides the adapter's credentials/config. */
  isConfigured(): boolean;
  initiatePayment(input: PaymentInitiationInput): Promise<PaymentInitiation>;
  verifyPayment(reference: string): Promise<PaymentVerification>;
  /**
   * Verify the delivery's signature and normalize it into a
   * `PaymentNotification`. Throws `WebhookVerificationError` on a bad or
   * missing signature, `WebhookUnsupportedError` when the gateway has no
   * webhook channel.
   */
  handleWebhook(input: WebhookInput): Promise<PaymentNotification>;
}
