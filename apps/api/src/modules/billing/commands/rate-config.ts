/**
 * Admin rate-config commands (MM-PLAN-001 §5 Phase 6b, §3.9): every rate
 * the revenue model uses — monthly fee, per-booking fee, commission
 * percentage — is a data row keyed (category × model × rate_kind), managed
 * here and referenced by charge computation at event time. Charges
 * SNAPSHOT the resolved rate; editing a rate never rewrites history.
 */
import type { z } from "zod";
import type {
  listBillingRatesInputSchema,
  setBillingRateInputSchema,
} from "@mesomed/contracts/billing";
import type { BillingCategory, BillingModel, RateKind } from "@mesomed/contracts/billing";
import { ErrorCode } from "@mesomed/contracts/errors";
import { and, billingRateConfig, eq, type DbExecutor, type DbTransaction } from "@mesomed/db";
import { AppError } from "../../../kernel/errors.js";

export type SetBillingRateInput = z.output<typeof setBillingRateInputSchema>;

export async function setBillingRate(
  tx: DbTransaction,
  input: SetBillingRateInput,
): Promise<{ id: string }> {
  const values = {
    category: input.category,
    model: input.model,
    rateKind: input.rateKind,
    value: input.value,
    currency: input.currency,
    active: input.active,
    updatedAt: new Date(),
  };
  const [row] = await tx
    .insert(billingRateConfig)
    .values(values)
    .onConflictDoUpdate({
      target: [billingRateConfig.category, billingRateConfig.model, billingRateConfig.rateKind],
      set: values,
    })
    .returning({ id: billingRateConfig.id });
  if (!row) throw new AppError(ErrorCode.INTERNAL, "Billing rate upsert returned no row");
  return { id: row.id };
}

export type ListBillingRatesInput = z.output<typeof listBillingRatesInputSchema>;

export async function listBillingRates(db: DbExecutor, input: ListBillingRatesInput) {
  const rows = await db
    .select({
      category: billingRateConfig.category,
      model: billingRateConfig.model,
      rateKind: billingRateConfig.rateKind,
      value: billingRateConfig.value,
      currency: billingRateConfig.currency,
      active: billingRateConfig.active,
    })
    .from(billingRateConfig)
    .where(
      input.category === undefined ? undefined : eq(billingRateConfig.category, input.category),
    );
  // `category` is stored as un-CHECKed text (extensible vocabulary, §3.9)
  // but only ever written through the contract-validated command above.
  return rows.map((row) => ({ ...row, category: row.category as BillingCategory }));
}

export interface ResolvedRate {
  value: number;
  currency: string;
}

/**
 * The ACTIVE rate for (category, model, kind), or a typed failure — a
 * charge that cannot resolve its rate must fail loudly (and dead-letter on
 * the event path) rather than silently under-bill.
 */
export async function requireActiveRate(
  db: DbExecutor,
  category: string,
  model: BillingModel,
  rateKind: RateKind,
): Promise<ResolvedRate> {
  const [row] = await db
    .select({
      value: billingRateConfig.value,
      currency: billingRateConfig.currency,
      active: billingRateConfig.active,
    })
    .from(billingRateConfig)
    .where(
      and(
        eq(billingRateConfig.category, category),
        eq(billingRateConfig.model, model),
        eq(billingRateConfig.rateKind, rateKind),
      ),
    )
    .limit(1);
  if (!row || !row.active) {
    throw new AppError(
      ErrorCode.RATE_NOT_CONFIGURED,
      `No active ${rateKind} rate for ${category}/${model}`,
    );
  }
  return { value: row.value, currency: row.currency };
}
