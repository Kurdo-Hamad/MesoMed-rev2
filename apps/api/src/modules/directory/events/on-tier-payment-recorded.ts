/**
 * Directory subscriber for billing.tier_payment_recorded.v1 (MM-PLAN-001
 * §5 Phase 6). Billing owns the authoritative tier state; the directory
 * mirrors the denormalized (tier_rank, tier_expires_at) pair that drives
 * its landing sort and re-emits the facility snapshot so the search read
 * model follows — all on the handler's idempotency-claimed transaction.
 */
import type { EventEnvelope, tierPaymentRecordedV1 } from "@mesomed/contracts";
import { categories, cities, eq, facilities } from "@mesomed/db/modules/directory";
import type { EventHandlerFn } from "../../../kernel/events.js";
import type { OutboxEmitter } from "../../../kernel/outbox.js";
import { packText } from "../shared.js";

export const ON_TIER_PAYMENT_RECORDED_HANDLER = "directory.sync-facility-tier";

export function createOnTierPaymentRecorded(deps: { outbox: OutboxEmitter }): EventHandlerFn {
  return async (envelope, tx) => {
    const { payload } = envelope as EventEnvelope<typeof tierPaymentRecordedV1>;
    const [facility] = await tx
      .select()
      .from(facilities)
      .where(eq(facilities.id, payload.facilityId))
      .for("update");
    // No directory facility for this id — nothing to mirror.
    if (!facility) return;

    const tierExpiresAt = new Date(payload.tierExpiresAt);
    await tx
      .update(facilities)
      .set({ tierRank: payload.tierRank, tierExpiresAt, updatedAt: new Date() })
      .where(eq(facilities.id, facility.id));

    const [category] = await tx
      .select({ slug: categories.slug })
      .from(categories)
      .where(eq(categories.id, facility.categoryId));
    const [city] = await tx
      .select({ slug: cities.slug })
      .from(cities)
      .where(eq(cities.id, facility.cityId));
    await deps.outbox.emit(tx, {
      name: "directory.facility_updated.v1",
      aggregateType: "facility",
      aggregateId: facility.id,
      payload: {
        facilityId: facility.id,
        slug: facility.slug,
        name: packText(facility.nameEn, facility.nameAr, facility.nameCkb),
        categorySlug: category?.slug ?? "",
        citySlug: city?.slug ?? "",
        tierRank: payload.tierRank,
        publiclyVisible: facility.publiclyVisible,
      },
    });
  };
}
