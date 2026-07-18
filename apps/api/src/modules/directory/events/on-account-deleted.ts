/**
 * Directory subscriber for identity.account_deleted.v2 (MM-QA-004 F-02
 * close-out, ADR-0038). A self-deleted provider's Better Auth CASCADE
 * removes provider_profiles without any status event, which would leave an
 * approved listing publicly visible and bookable with no account behind
 * it. When the deleted account had a provider profile, retire the mirrored
 * listing — the same approved-flag + visibility-recompute mechanism as
 * directory.sync-provider-approval, on the handler's idempotency-claimed
 * transaction so redelivery is a provable no-op.
 */
import type { accountDeletedV2, EventEnvelope } from "@mesomed/contracts";
import { eq, providers } from "@mesomed/db/modules/directory";
import type { EventHandlerFn } from "../../../kernel/events.js";
import type { OutboxEmitter } from "../../../kernel/outbox.js";
import { recomputeProviderVisibility } from "../shared.js";

export const ON_ACCOUNT_DELETED_HANDLER = "directory.retire-deleted-provider";

export function createOnAccountDeleted(deps: { outbox: OutboxEmitter }): EventHandlerFn {
  return async (envelope, tx) => {
    const { payload } = envelope as EventEnvelope<typeof accountDeletedV2>;
    // Patient-only deletions carry no provider profile — nothing to retire.
    if (payload.providerProfileId === null) return;
    const [provider] = await tx
      .select({ id: providers.id })
      .from(providers)
      .where(eq(providers.identityProfileId, payload.providerProfileId))
      .for("update");
    // Never listed (e.g. signup never completed, or a secretary) — no-op.
    if (!provider) return;

    await tx
      .update(providers)
      .set({ approved: false, updatedAt: new Date() })
      .where(eq(providers.id, provider.id));

    await recomputeProviderVisibility(tx, deps.outbox, provider.id);
  };
}
