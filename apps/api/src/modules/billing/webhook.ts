/**
 * Payment webhook surface (MM-PLAN-001 §5 Phase 6) — fixes the old
 * codebase's documented gaps, none of which may be omitted:
 *
 *   1. Zod-validated body (the platform-normalized envelope) before any
 *      processing;
 *   2. signature verification through the gateway adapter's
 *      `handleWebhook` (real per-gateway schemes land with the FIB/
 *      ZainCash adapters — the interface is what they implement);
 *   3. @fastify/rate-limit on the route.
 *
 * The routes live in their own encapsulated Fastify scope so the
 * string-preserving JSON parser (signatures verify the exact signed
 * bytes, never re-serialized JSON) and the rate limiter apply here only.
 *
 * Settlement goes through the same idempotent apply* commands as admin
 * recording: a duplicate delivery answers 200 with `applied: false` and
 * changes nothing — gateways stop retrying, state stays put.
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { paymentWebhookBodySchema } from "@mesomed/contracts/billing";
import type { Db } from "@mesomed/db";
import {
  WebhookUnsupportedError,
  WebhookVerificationError,
  type PaymentNotification,
} from "@mesomed/platform";
import { AppError } from "../../kernel/errors.js";
import type { OutboxEmitter } from "../../kernel/outbox.js";
import { applyTierPayment } from "./commands/tier-payment.js";
import { applySubscriptionPayment } from "./commands/subscription.js";
import type { PaymentGatewayRegistry } from "./shared.js";

export const PAYMENT_WEBHOOK_PATH = "/webhooks/payments/:gateway";

export interface PaymentWebhookDeps {
  db: Db;
  outbox: OutboxEmitter;
  gateways: PaymentGatewayRegistry;
  rateLimit: { max: number; timeWindowMs: number };
}

function reject(reply: FastifyReply, status: number, error: string) {
  return reply.code(status).send({ error });
}

async function settle(
  deps: PaymentWebhookDeps,
  gatewayId: string,
  notification: PaymentNotification,
): Promise<{ applied: boolean }> {
  const shared = {
    idempotencyKey: notification.idempotencyKey,
    periods: notification.periods,
    amount: notification.amount,
    currency: notification.currency,
    gateway: gatewayId,
    reference: notification.reference,
    recordedBy: `gateway:${gatewayId}`,
  };
  if (notification.kind === "tier_payment") {
    if (!notification.facilityId || !notification.tierKey) {
      throw new WebhookVerificationError("tier_payment notification missing target fields");
    }
    const { facilityId, tierKey } = notification;
    return deps.db.transaction((tx) =>
      applyTierPayment(tx, deps.outbox, { ...shared, facilityId, tierKey }),
    );
  }
  if (!notification.doctorProfileId) {
    throw new WebhookVerificationError("subscription notification missing doctorProfileId");
  }
  const { doctorProfileId } = notification;
  return deps.db.transaction((tx) =>
    applySubscriptionPayment(tx, deps.outbox, { ...shared, doctorProfileId }),
  );
}

export async function registerPaymentWebhookRoutes(
  app: FastifyInstance,
  deps: PaymentWebhookDeps,
): Promise<void> {
  await app.register(async (scope) => {
    await scope.register(rateLimit, {
      max: deps.rateLimit.max,
      timeWindow: deps.rateLimit.timeWindowMs,
    });
    // Keep the exact request bytes: adapters verify signatures over what
    // the gateway signed, not over a re-serialized parse.
    scope.addContentTypeParser(
      "application/json",
      { parseAs: "string" },
      (_req, body, done) => done(null, body),
    );

    scope.post(PAYMENT_WEBHOOK_PATH, async (request, reply) => {
      const { gateway: gatewayId } = request.params as { gateway: string };
      const gateway = deps.gateways[gatewayId];
      if (!gateway || !gateway.isConfigured()) {
        return reject(reply, 404, "UNKNOWN_GATEWAY");
      }

      const rawBody = typeof request.body === "string" ? request.body : "";
      let json: unknown;
      try {
        json = JSON.parse(rawBody);
      } catch {
        return reject(reply, 400, "INVALID_JSON");
      }
      if (!paymentWebhookBodySchema.safeParse(json).success) {
        return reject(reply, 400, "INVALID_SCHEMA");
      }

      let notification: PaymentNotification;
      try {
        notification = await gateway.handleWebhook({ rawBody, headers: request.headers });
      } catch (error) {
        if (error instanceof WebhookUnsupportedError) {
          return reject(reply, 404, "WEBHOOK_UNSUPPORTED");
        }
        if (error instanceof WebhookVerificationError) {
          return reject(reply, 401, "INVALID_SIGNATURE");
        }
        throw error;
      }

      try {
        const { applied } = await settle(deps, gatewayId, notification);
        return reply.code(200).send({ received: true, applied });
      } catch (error) {
        // Typed domain rejections (unknown facility/tier/doctor) are the
        // sender's data problem, not a server fault — surface the app code.
        if (error instanceof AppError) return reject(reply, 400, error.code);
        if (error instanceof WebhookVerificationError) {
          return reject(reply, 400, "INVALID_NOTIFICATION");
        }
        throw error;
      }
    });
  });
}
