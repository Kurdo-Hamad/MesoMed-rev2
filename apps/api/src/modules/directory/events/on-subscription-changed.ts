/**
 * Directory subscribers for billing.subscription_activated/expired.v1
 * (MM-PLAN-001 §5 Phase 6). The directory owns its read state: it mirrors
 * the subscription into `providers.subscription_active` and recomputes the
 * denormalized visibility flags through the SAME centralized predicate and
 * emit path every other visibility source uses — billing never writes
 * directory tables (§3.1). Runs on the handler's idempotency-claimed
 * transaction, so redelivery is a provable no-op.
 */
import type {
  EventEnvelope,
  subscriptionActivatedV1,
  subscriptionExpiredV1,
} from "@mesomed/contracts";
import { doctorProfiles, eq, providers } from "@mesomed/db/modules/directory";
import type { EventHandlerFn } from "../../../kernel/events.js";
import type { OutboxEmitter } from "../../../kernel/outbox.js";
import { recomputeProviderVisibility } from "../shared.js";

export const ON_SUBSCRIPTION_ACTIVATED_HANDLER = "directory.sync-subscription-activated";
export const ON_SUBSCRIPTION_EXPIRED_HANDLER = "directory.sync-subscription-expired";

type SubscriptionEnvelope =
  EventEnvelope<typeof subscriptionActivatedV1> | EventEnvelope<typeof subscriptionExpiredV1>;

function createSyncHandler(deps: { outbox: OutboxEmitter }, active: boolean): EventHandlerFn {
  return async (envelope, tx) => {
    const { payload } = envelope as SubscriptionEnvelope;
    const [doctor] = await tx
      .select({ providerId: doctorProfiles.providerId })
      .from(doctorProfiles)
      .where(eq(doctorProfiles.id, payload.doctorProfileId))
      .for("update");
    // No directory listing for this doctor profile id — nothing to mirror.
    if (!doctor) return;

    await tx
      .update(providers)
      .set({ subscriptionActive: active, updatedAt: new Date() })
      .where(eq(providers.id, doctor.providerId));

    await recomputeProviderVisibility(tx, deps.outbox, doctor.providerId);
  };
}

export function createOnSubscriptionActivated(deps: { outbox: OutboxEmitter }): EventHandlerFn {
  return createSyncHandler(deps, true);
}

export function createOnSubscriptionExpired(deps: { outbox: OutboxEmitter }): EventHandlerFn {
  return createSyncHandler(deps, false);
}
