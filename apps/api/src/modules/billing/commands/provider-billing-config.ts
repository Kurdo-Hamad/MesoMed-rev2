/**
 * Provider revenue-model selection (MM-PLAN-001 §5 Phase 6b): every
 * provider holds exactly one `provider_billing_config` row naming its
 * subscription model (flat_monthly | commission). The category is
 * snapshotted from the directory's provider type through the published
 * provider ref (§3.1) so charge-time rate resolution never joins directory
 * tables. Rates always resolve from `billing_rate_config` at charge time —
 * this row never stores a fee amount; `booking_value_minor` is the
 * provider's declared booking value (the commission base), not a rate.
 */
import type { z } from "zod";
import type { setProviderBillingModelInputSchema } from "@mesomed/contracts/billing";
import { BILLING_CATEGORIES, type BillingCategory } from "@mesomed/contracts/billing";
import { ErrorCode } from "@mesomed/contracts/errors";
import {
  eq,
  listingTiers,
  providerBillingConfig,
  type DbExecutor,
  type DbTransaction,
} from "@mesomed/db";
import { resolveTrialDefaultMonths, type ConfigReader } from "@mesomed/config";
import { trialEndsAt } from "@mesomed/domain/billing";
import { AppError } from "../../../kernel/errors.js";
import { getProviderRef } from "../../directory/queries/provider-refs.js";
import { requireActiveTier } from "../shared.js";

export type SetProviderBillingModelInput = Omit<
  z.output<typeof setProviderBillingModelInputSchema>,
  "providerId"
> & { providerId: string };

export async function setProviderBillingModel(
  tx: DbTransaction,
  input: SetProviderBillingModelInput,
): Promise<{ id: string; created: boolean }> {
  const ref = await getProviderRef(tx, input.providerId);
  if (!ref) {
    throw new AppError(ErrorCode.NOT_FOUND, `Unknown provider "${input.providerId}"`);
  }
  if (!(BILLING_CATEGORIES as readonly string[]).includes(ref.providerType)) {
    throw new AppError(
      ErrorCode.VALIDATION,
      `Provider type "${ref.providerType}" has no billing category`,
    );
  }

  const tierId = input.tierKey == null ? null : (await requireActiveTier(tx, input.tierKey)).id;

  const [existing] = await tx
    .select({ id: providerBillingConfig.id })
    .from(providerBillingConfig)
    .where(eq(providerBillingConfig.providerId, input.providerId))
    .for("update");

  const values = {
    providerId: input.providerId,
    category: ref.providerType,
    model: input.model,
    tierId,
    bookingValueMinor: input.model === "commission" ? (input.bookingValueMinor ?? null) : null,
    trialEndsAt: input.trialEndsAt === undefined ? undefined : toDateOrNull(input.trialEndsAt),
    updatedAt: new Date(),
  };

  if (existing) {
    await tx
      .update(providerBillingConfig)
      .set(values)
      .where(eq(providerBillingConfig.id, existing.id));
    return { id: existing.id, created: false };
  }
  const [inserted] = await tx
    .insert(providerBillingConfig)
    .values({ ...values, trialEndsAt: toDateOrNull(input.trialEndsAt ?? null) })
    .returning({ id: providerBillingConfig.id });
  if (!inserted) {
    throw new AppError(ErrorCode.INTERNAL, "Provider billing config insert returned no row");
  }
  return { id: inserted.id, created: true };
}

function toDateOrNull(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

export interface ProviderBillingConfigView {
  id: string;
  providerId: string;
  category: BillingCategory;
  model: "flat_monthly" | "commission";
  tierKey: string | null;
  bookingValueMinor: number | null;
  trialEndsAt: string | null;
  effectiveTrialEndsAt: string | null;
  createdAt: string;
}

/** The provider's billing config with the trial window resolved. */
export async function getProviderBillingConfig(
  db: DbExecutor,
  config: ConfigReader,
  providerId: string,
): Promise<ProviderBillingConfigView | null> {
  const [row] = await db
    .select({
      id: providerBillingConfig.id,
      providerId: providerBillingConfig.providerId,
      category: providerBillingConfig.category,
      model: providerBillingConfig.model,
      tierKey: listingTiers.key,
      bookingValueMinor: providerBillingConfig.bookingValueMinor,
      trialEndsAt: providerBillingConfig.trialEndsAt,
      createdAt: providerBillingConfig.createdAt,
    })
    .from(providerBillingConfig)
    .leftJoin(listingTiers, eq(listingTiers.id, providerBillingConfig.tierId))
    .where(eq(providerBillingConfig.providerId, providerId))
    .limit(1);
  if (!row) return null;

  const defaultMonths = await resolveTrialDefaultMonths(config);
  const effective = trialEndsAt({
    trialOverride: row.trialEndsAt,
    anchor: row.createdAt,
    defaultMonths,
  });
  return {
    id: row.id,
    providerId: row.providerId,
    category: row.category as BillingCategory,
    model: row.model,
    tierKey: row.tierKey,
    bookingValueMinor: row.bookingValueMinor,
    trialEndsAt: row.trialEndsAt?.toISOString() ?? null,
    effectiveTrialEndsAt: effective?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
