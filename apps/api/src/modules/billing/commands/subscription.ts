/**
 * Doctor-subscription lifecycle (MM-PLAN-001 §5 Phase 6): flat monthly,
 * status active / grace_period / inactive. `applySubscriptionPayment` is
 * the single settlement path (admin manual command and gateway webhooks);
 * replays are no-ops via the unique idempotency key. Events emitted in the
 * same transaction (§3.2): activation on every settlement; expiry ONLY on
 * the transition to `inactive` — grace retains public visibility, so it is
 * not an integration signal.
 */
import { paymentPeriod } from "@mesomed/domain/billing";
import { ErrorCode } from "@mesomed/contracts/errors";
import { eq, subscriptionPayments, subscriptions, type DbTransaction } from "@mesomed/db";
import { AppError } from "../../../kernel/errors.js";
import type { OutboxEmitter } from "../../../kernel/outbox.js";
import { doctorProfileExists } from "../../directory/queries/doctor-profile-refs.js";

type SubscriptionRow = typeof subscriptions.$inferSelect;

/** The doctor's subscription row, locked on this transaction. */
async function lockSubscription(
  tx: DbTransaction,
  doctorProfileId: string,
): Promise<SubscriptionRow | undefined> {
  const [row] = await tx
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.doctorProfileId, doctorProfileId))
    .for("update");
  return row;
}

export interface ApplySubscriptionPaymentInput {
  idempotencyKey: string;
  doctorProfileId: string;
  periods: number;
  amount: number;
  currency: string;
  gateway: string;
  reference: string | null;
  /** Admin user id, or "gateway:<id>" for webhook-recorded payments. */
  recordedBy: string;
}

export interface ApplySubscriptionPaymentResult {
  applied: boolean;
  subscriptionId: string;
  status: SubscriptionRow["status"];
  paidUntil: string | null;
}

export async function applySubscriptionPayment(
  tx: DbTransaction,
  outbox: OutboxEmitter,
  input: ApplySubscriptionPaymentInput,
): Promise<ApplySubscriptionPaymentResult> {
  if (!(await doctorProfileExists(tx, input.doctorProfileId))) {
    throw new AppError(ErrorCode.NOT_FOUND, `Unknown doctor profile "${input.doctorProfileId}"`);
  }

  let subscription = await lockSubscription(tx, input.doctorProfileId);
  if (!subscription) {
    // First-ever payment: create the aggregate row, tolerating a concurrent
    // creator (unique doctorProfileId), then re-lock whichever row won.
    await tx
      .insert(subscriptions)
      .values({ doctorProfileId: input.doctorProfileId })
      .onConflictDoNothing();
    subscription = await lockSubscription(tx, input.doctorProfileId);
    if (!subscription) {
      throw new AppError(ErrorCode.INTERNAL, "Subscription row vanished during creation");
    }
  }

  const { periodStart, periodEnd } = paymentPeriod(subscription.paidUntil, input.periods);

  const inserted = await tx
    .insert(subscriptionPayments)
    .values({
      subscriptionId: subscription.id,
      idempotencyKey: input.idempotencyKey,
      periodStart,
      periodEnd,
      amount: input.amount,
      currency: input.currency,
      gateway: input.gateway,
      reference: input.reference,
      recordedBy: input.recordedBy,
    })
    .onConflictDoNothing()
    .returning({ id: subscriptionPayments.id });

  if (inserted.length === 0) {
    return {
      applied: false,
      subscriptionId: subscription.id,
      status: subscription.status,
      paidUntil: subscription.paidUntil?.toISOString() ?? null,
    };
  }

  await tx
    .update(subscriptions)
    .set({ status: "active", paidUntil: periodEnd, updatedAt: new Date() })
    .where(eq(subscriptions.id, subscription.id));

  await outbox.emit(tx, {
    name: "billing.subscription_activated.v1",
    aggregateType: "subscription",
    aggregateId: subscription.id,
    payload: {
      subscriptionId: subscription.id,
      doctorProfileId: input.doctorProfileId,
      paidUntil: periodEnd.toISOString(),
    },
  });

  return {
    applied: true,
    subscriptionId: subscription.id,
    status: "active",
    paidUntil: periodEnd.toISOString(),
  };
}

export interface ExpireSubscriptionInput {
  doctorProfileId: string;
  /** True lapses into grace_period (still publicly visible); false deactivates. */
  toGrace: boolean;
}

export interface ExpireSubscriptionResult {
  subscriptionId: string;
  status: SubscriptionRow["status"];
}

export async function expireSubscription(
  tx: DbTransaction,
  outbox: OutboxEmitter,
  input: ExpireSubscriptionInput,
): Promise<ExpireSubscriptionResult> {
  const subscription = await lockSubscription(tx, input.doctorProfileId);
  if (!subscription) {
    throw new AppError(
      ErrorCode.NOT_FOUND,
      `No subscription for doctor profile "${input.doctorProfileId}"`,
    );
  }

  if (input.toGrace) {
    // Grace is a lapse of an ACTIVE subscription, not a resurrection path.
    if (subscription.status !== "active") {
      throw new AppError(
        ErrorCode.INVALID_STATUS_TRANSITION,
        `Cannot enter grace period from "${subscription.status}"`,
      );
    }
    await tx
      .update(subscriptions)
      .set({ status: "grace_period", updatedAt: new Date() })
      .where(eq(subscriptions.id, subscription.id));
    return { subscriptionId: subscription.id, status: "grace_period" };
  }

  if (subscription.status === "inactive") {
    throw new AppError(ErrorCode.INVALID_STATUS_TRANSITION, "Subscription is already inactive");
  }
  await tx
    .update(subscriptions)
    .set({ status: "inactive", updatedAt: new Date() })
    .where(eq(subscriptions.id, subscription.id));

  await outbox.emit(tx, {
    name: "billing.subscription_expired.v1",
    aggregateType: "subscription",
    aggregateId: subscription.id,
    payload: {
      subscriptionId: subscription.id,
      doctorProfileId: input.doctorProfileId,
    },
  });

  return { subscriptionId: subscription.id, status: "inactive" };
}
