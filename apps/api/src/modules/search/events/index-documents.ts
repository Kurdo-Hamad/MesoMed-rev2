/**
 * Search read-model subscribers (MM-PLAN-001 §5 Phase 3). Consume directory
 * events off the outbox dispatcher and upsert `search_documents` — the
 * search module's own table (§3.1); every field comes from the event
 * payload, never from a directory join. Handlers run on the dispatcher's
 * idempotency-claimed transaction and the write is a keyed upsert, so
 * redelivery converges on the same row (§ Phase 1 gate semantics).
 */
import type { EventEnvelope, doctorProfileCreatedV1, facilityCreatedV1 } from "@mesomed/contracts";
import { searchDocuments } from "@mesomed/db";
import { sql } from "@mesomed/db";
import type { EventHandlerFn } from "../../../kernel/events.js";

export const INDEX_FACILITY_HANDLER = "search.index-facility";
export const INDEX_DOCTOR_HANDLER = "search.index-doctor";

/** facility_created.v1 and facility_updated.v1 share the snapshot payload. */
export const indexFacilityDocument: EventHandlerFn = async (envelope, tx) => {
  const { payload } = envelope as EventEnvelope<typeof facilityCreatedV1>;
  await tx
    .insert(searchDocuments)
    .values({
      entityType: "facility",
      entityId: payload.facilityId,
      slug: payload.slug,
      nameEn: payload.name.en,
      nameAr: payload.name.ar,
      nameCkb: payload.name.ckb,
      categoryKey: payload.categorySlug,
      citySlug: payload.citySlug,
      publiclyVisible: payload.publiclyVisible,
      rank: payload.tierRank,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [searchDocuments.entityType, searchDocuments.entityId],
      set: {
        slug: sql`excluded.slug`,
        nameEn: sql`excluded.name_en`,
        nameAr: sql`excluded.name_ar`,
        nameCkb: sql`excluded.name_ckb`,
        categoryKey: sql`excluded.category_key`,
        citySlug: sql`excluded.city_slug`,
        publiclyVisible: sql`excluded.publicly_visible`,
        rank: sql`excluded.rank`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
};

/** doctor_profile_created.v1 / doctor_profile_updated.v1. */
export const indexDoctorDocument: EventHandlerFn = async (envelope, tx) => {
  const { payload } = envelope as EventEnvelope<typeof doctorProfileCreatedV1>;
  await tx
    .insert(searchDocuments)
    .values({
      entityType: "doctor",
      entityId: payload.doctorProfileId,
      slug: payload.slug,
      nameEn: payload.name.en,
      nameAr: payload.name.ar,
      nameCkb: payload.name.ckb,
      categoryKey: payload.specialtyKey,
      citySlug: payload.citySlug,
      publiclyVisible: payload.publiclyVisible,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [searchDocuments.entityType, searchDocuments.entityId],
      set: {
        slug: sql`excluded.slug`,
        nameEn: sql`excluded.name_en`,
        nameAr: sql`excluded.name_ar`,
        nameCkb: sql`excluded.name_ckb`,
        categoryKey: sql`excluded.category_key`,
        citySlug: sql`excluded.city_slug`,
        publiclyVisible: sql`excluded.publicly_visible`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
};
