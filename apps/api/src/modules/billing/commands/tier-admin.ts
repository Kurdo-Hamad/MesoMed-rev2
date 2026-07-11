/**
 * Admin tier taxonomy + pricing + routing commands (MM-PLAN-001 §5 Phase 6,
 * §3.9): tiers, prices and gateway routing are data rows, so launching a
 * new tier/price/country is an admin mutation, never a deploy. All are
 * admin-role-gated at the router (§3.6 layer a); no finer ownership exists
 * for platform-level configuration (layer b is the role itself).
 */
import type { z } from "zod";
import type {
  setPaymentRoutingInputSchema,
  setTierPriceInputSchema,
  upsertListingTierInputSchema,
} from "@mesomed/contracts/billing";
import { ErrorCode } from "@mesomed/contracts/errors";
import { paymentRoutingSchema, PAYMENT_ROUTING_CONFIG_KEY } from "@mesomed/config";
import { eq, listingTiers, tierPrices, type DbTransaction } from "@mesomed/db";
import type { ConfigService } from "../../../kernel/config.js";
import { AppError } from "../../../kernel/errors.js";
import { KNOWN_GATEWAY_IDS, type PaymentGatewayRegistry } from "../shared.js";

export type UpsertListingTierInput = z.output<typeof upsertListingTierInputSchema>;

export async function upsertListingTier(
  tx: DbTransaction,
  input: UpsertListingTierInput,
): Promise<{ id: string; created: boolean }> {
  const [existing] = await tx
    .select({ id: listingTiers.id })
    .from(listingTiers)
    .where(eq(listingTiers.key, input.key))
    .for("update");

  const values = {
    key: input.key,
    rank: input.rank,
    nameEn: input.name.en,
    nameAr: input.name.ar,
    nameCkb: input.name.ckb,
    active: input.active,
    updatedAt: new Date(),
  };

  if (existing) {
    await tx.update(listingTiers).set(values).where(eq(listingTiers.id, existing.id));
    return { id: existing.id, created: false };
  }
  const [inserted] = await tx
    .insert(listingTiers)
    .values(values)
    .returning({ id: listingTiers.id });
  if (!inserted) throw new AppError(ErrorCode.INTERNAL, "Listing tier insert returned no row");
  return { id: inserted.id, created: true };
}

export type SetTierPriceInput = z.output<typeof setTierPriceInputSchema>;

export async function setTierPrice(
  tx: DbTransaction,
  input: SetTierPriceInput,
): Promise<{ id: string }> {
  const [tier] = await tx
    .select({ id: listingTiers.id })
    .from(listingTiers)
    .where(eq(listingTiers.key, input.tierKey));
  if (!tier) throw new AppError(ErrorCode.VALIDATION, `Unknown listing tier "${input.tierKey}"`);

  const values = {
    tierId: tier.id,
    countryCode: input.countryCode,
    currency: input.currency,
    amount: input.amount,
    active: input.active,
    updatedAt: new Date(),
  };
  const [row] = await tx
    .insert(tierPrices)
    .values(values)
    .onConflictDoUpdate({
      target: [tierPrices.tierId, tierPrices.countryCode],
      set: values,
    })
    .returning({ id: tierPrices.id });
  if (!row) throw new AppError(ErrorCode.INTERNAL, "Tier price upsert returned no row");
  return { id: row.id };
}

export type SetPaymentRoutingInput = z.output<typeof setPaymentRoutingInputSchema>;

/**
 * Point (country, kind) at a gateway id. Accepts adapters registered in
 * the composition root plus the KNOWN launch ids (fib/zaincash may be
 * staged in config before their adapters land — resolution stays fail-
 * closed until then).
 */
export async function setPaymentRouting(
  config: ConfigService,
  gateways: PaymentGatewayRegistry,
  input: SetPaymentRoutingInput,
): Promise<void> {
  const known =
    input.gateway in gateways || (KNOWN_GATEWAY_IDS as readonly string[]).includes(input.gateway);
  if (!known) {
    throw new AppError(ErrorCode.VALIDATION, `Unknown payment gateway "${input.gateway}"`);
  }

  let routing: z.infer<typeof paymentRoutingSchema>;
  try {
    routing = await config.get(paymentRoutingSchema, PAYMENT_ROUTING_CONFIG_KEY);
  } catch (error) {
    if (error instanceof AppError && error.code === ErrorCode.NOT_FOUND) routing = {};
    else throw error;
  }
  routing = {
    ...routing,
    [input.countryCode]: { ...routing[input.countryCode], [input.kind]: input.gateway },
  };
  await config.set(paymentRoutingSchema, PAYMENT_ROUTING_CONFIG_KEY, routing);
}
