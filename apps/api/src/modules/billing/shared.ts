/**
 * Billing module internals shared by commands, queries and the webhook
 * surface — notably the PaymentOrchestrator's gateway resolution: routing
 * is config data (packages/config, §3.9), adapters are injected from the
 * composition root (§3.8), and every failure is a typed error (§3.11).
 */
import type { PaymentKind } from "@mesomed/contracts/billing";
import { ErrorCode } from "@mesomed/contracts/errors";
import { resolvePaymentGatewayId } from "@mesomed/config";
import { eq, listingTiers, type DbExecutor } from "@mesomed/db";
import type { PaymentGateway } from "@mesomed/platform";
import type { ConfigService } from "../../kernel/config.js";
import { AppError } from "../../kernel/errors.js";

/**
 * Gateway ids the platform recognizes at launch: `manual` ships complete;
 * `fib` and `zaincash` are registered as routable ids so config can be
 * staged ahead of their adapters (interface-ready, §8 deferral) — resolving
 * one of them fails typed until its adapter is wired.
 */
export const KNOWN_GATEWAY_IDS = ["manual", "fib", "zaincash"] as const;

/** Adapter registry wired in the composition root, keyed by gateway id. */
export type PaymentGatewayRegistry = Readonly<Record<string, PaymentGateway>>;

/**
 * Resolve the gateway for (country, payment kind) through the routing
 * config. No routing entry, an unregistered adapter and an unconfigured
 * adapter all fail closed with PAYMENT_GATEWAY_NOT_CONFIGURED.
 */
export async function resolveGateway(
  config: ConfigService,
  gateways: PaymentGatewayRegistry,
  country: string,
  kind: PaymentKind,
): Promise<PaymentGateway> {
  const gatewayId = await resolvePaymentGatewayId(config, country, kind);
  if (gatewayId === null) {
    throw new AppError(
      ErrorCode.PAYMENT_GATEWAY_NOT_CONFIGURED,
      `No payment gateway routed for ${country.toUpperCase()}/${kind}`,
    );
  }
  const gateway = gateways[gatewayId];
  if (!gateway || !gateway.isConfigured()) {
    throw new AppError(
      ErrorCode.PAYMENT_GATEWAY_NOT_CONFIGURED,
      `Payment gateway "${gatewayId}" is not available`,
    );
  }
  return gateway;
}

export interface TierRow {
  id: string;
  key: string;
  rank: number;
}

/** Resolve an ACTIVE listing tier by key; VALIDATION when absent/inactive. */
export async function requireActiveTier(db: DbExecutor, tierKey: string): Promise<TierRow> {
  const [tier] = await db
    .select({
      id: listingTiers.id,
      key: listingTiers.key,
      rank: listingTiers.rank,
      active: listingTiers.active,
    })
    .from(listingTiers)
    .where(eq(listingTiers.key, tierKey));
  if (!tier) throw new AppError(ErrorCode.VALIDATION, `Unknown listing tier "${tierKey}"`);
  if (!tier.active) {
    throw new AppError(ErrorCode.VALIDATION, `Listing tier "${tierKey}" is inactive`);
  }
  return { id: tier.id, key: tier.key, rank: tier.rank };
}
