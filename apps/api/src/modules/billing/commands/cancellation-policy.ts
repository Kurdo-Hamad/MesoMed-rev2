/**
 * Provider cancellation/no-show policy CRUD (MM-PLAN-001 §5 Phase 6b).
 * Fully functional NOW — providers/admins set the free-cancellation
 * window and fees today; whether an applicable fee is COLLECTED from the
 * patient stays gated by the global `billing.patient_collection_enabled`
 * config flag (default false) evaluated in the booking-event subscribers.
 */
import type { z } from "zod";
import type { setCancellationPolicyInputSchema } from "@mesomed/contracts/billing";
import { ErrorCode } from "@mesomed/contracts/errors";
import { eq, providerCancellationPolicy, type DbExecutor, type DbTransaction } from "@mesomed/db";
import { AppError } from "../../../kernel/errors.js";
import { getProviderRef } from "../../directory/queries/provider-refs.js";

export type SetCancellationPolicyInput = Omit<
  z.output<typeof setCancellationPolicyInputSchema>,
  "providerId"
> & { providerId: string };

export async function setCancellationPolicy(
  tx: DbTransaction,
  input: SetCancellationPolicyInput,
): Promise<{ id: string }> {
  if (!(await getProviderRef(tx, input.providerId))) {
    throw new AppError(ErrorCode.NOT_FOUND, `Unknown provider "${input.providerId}"`);
  }
  const values = {
    providerId: input.providerId,
    freeCancellationWindowHours: input.freeCancellationWindowHours,
    cancellationFeeMinor: input.cancellationFeeMinor,
    noShowFeeMinor: input.noShowFeeMinor,
    currency: input.currency,
    enabled: input.enabled,
    updatedAt: new Date(),
  };
  const [row] = await tx
    .insert(providerCancellationPolicy)
    .values(values)
    .onConflictDoUpdate({ target: providerCancellationPolicy.providerId, set: values })
    .returning({ id: providerCancellationPolicy.id });
  if (!row) throw new AppError(ErrorCode.INTERNAL, "Cancellation policy upsert returned no row");
  return { id: row.id };
}

export interface CancellationPolicyView {
  providerId: string;
  freeCancellationWindowHours: number;
  cancellationFeeMinor: number;
  noShowFeeMinor: number;
  currency: string;
  enabled: boolean;
}

export async function getCancellationPolicy(
  db: DbExecutor,
  providerId: string,
): Promise<CancellationPolicyView | null> {
  const [row] = await db
    .select({
      providerId: providerCancellationPolicy.providerId,
      freeCancellationWindowHours: providerCancellationPolicy.freeCancellationWindowHours,
      cancellationFeeMinor: providerCancellationPolicy.cancellationFeeMinor,
      noShowFeeMinor: providerCancellationPolicy.noShowFeeMinor,
      currency: providerCancellationPolicy.currency,
      enabled: providerCancellationPolicy.enabled,
    })
    .from(providerCancellationPolicy)
    .where(eq(providerCancellationPolicy.providerId, providerId))
    .limit(1);
  return row ?? null;
}
