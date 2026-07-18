/**
 * Directory subscriber for identity.provider_status_changed.v1 (Phase 2
 * gate: public ⇔ approved). Syncs the mirrored `providers.approved` flag,
 * recomputes each listing's denormalized visibility and re-emits
 * directory.*_updated.v1 for flipped listings — all on the handler's
 * idempotency-claimed transaction, so redelivery is a provable no-op.
 */
import type { EventEnvelope, providerStatusChangedV1 } from "@mesomed/contracts";
import { eq, providers } from "@mesomed/db/modules/directory";
import type { EventHandlerFn } from "../../../kernel/events.js";
import type { OutboxEmitter } from "../../../kernel/outbox.js";
import { recomputeProviderVisibility } from "../shared.js";

export const ON_PROVIDER_STATUS_CHANGED_HANDLER = "directory.sync-provider-approval";

export function createOnProviderStatusChanged(deps: { outbox: OutboxEmitter }): EventHandlerFn {
  return async (envelope, tx) => {
    const { payload } = envelope as EventEnvelope<typeof providerStatusChangedV1>;
    const [provider] = await tx
      .select({ id: providers.id })
      .from(providers)
      .where(eq(providers.identityProfileId, payload.providerProfileId))
      .for("update");
    // No directory listing exists for this identity profile (yet) — the
    // approval state is picked up when the listing is created.
    if (!provider) return;

    await tx
      .update(providers)
      .set({ approved: payload.to === "approved", updatedAt: new Date() })
      .where(eq(providers.id, provider.id));

    await recomputeProviderVisibility(tx, deps.outbox, provider.id);
  };
}
