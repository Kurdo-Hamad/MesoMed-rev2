/**
 * Admin facility upsert (MM-PLAN-001 §5 Phase 3). Creates or updates a
 * facility listing (keyed by slug) with wholesale-replaced media and
 * sections, recomputes the public-visibility flag and emits
 * directory.facility_created/updated.v1 in the same transaction (§3.2).
 */
import type { z } from "zod";
import type { upsertFacilityInputSchema } from "@mesomed/contracts/directory";
import { ErrorCode } from "@mesomed/contracts/errors";
import type { DIRECTORY_PROVIDER_TYPES } from "@mesomed/db";
import {
  eq,
  facilities,
  facilityMedia,
  facilitySections,
  facilitySectionTypes,
  inArray,
  providers,
  type DbTransaction,
} from "@mesomed/db";
import { AppError } from "../../../kernel/errors.js";
import type { OutboxEmitter } from "../../../kernel/outbox.js";
import { isProviderProfileApproved } from "../../identity/queries/provider-visibility.js";
import { packText, requireCategoryId, requireCityId } from "../shared.js";

export type UpsertFacilityInput = z.output<typeof upsertFacilityInputSchema> & {
  /** Directory provider type of the listing; defaults to "hospital". */
  providerType?: (typeof DIRECTORY_PROVIDER_TYPES)[number];
  /** Deterministic id for seed/import creates — never exposed via tRPC. */
  id?: string;
};

export async function upsertFacility(
  tx: DbTransaction,
  outbox: OutboxEmitter,
  input: UpsertFacilityInput,
): Promise<{ id: string; created: boolean }> {
  const categoryId = await requireCategoryId(tx, input.categorySlug);
  const cityId = await requireCityId(tx, input.citySlug);

  const [existing] = await tx
    .select({ id: facilities.id, providerId: facilities.providerId })
    .from(facilities)
    .where(eq(facilities.slug, input.slug))
    .for("update");

  // Listing owner: a registered identity provider profile when given
  // (approval mirrored from identity via published query — never a join,
  // §3.1); otherwise an admin-curated provider approved by construction.
  let providerId: string;
  if (existing) {
    providerId = existing.providerId;
  } else {
    const approved = input.identityProfileId
      ? await isProviderProfileApproved(tx, input.identityProfileId)
      : true;
    const [provider] = await tx
      .insert(providers)
      .values({
        providerType: input.providerType ?? "hospital",
        identityProfileId: input.identityProfileId ?? null,
        approved,
      })
      .returning({ id: providers.id });
    if (!provider) throw new AppError(ErrorCode.INTERNAL, "Provider insert returned no row");
    providerId = provider.id;
  }

  const [provider] = await tx
    .select({ approved: providers.approved })
    .from(providers)
    .where(eq(providers.id, providerId));
  const publiclyVisible = (provider?.approved ?? false) && input.active;

  const values = {
    providerId,
    categoryId,
    cityId,
    slug: input.slug,
    nameEn: input.name.en,
    nameAr: input.name.ar,
    nameCkb: input.name.ckb,
    addressEn: input.address?.en ?? null,
    addressAr: input.address?.ar ?? null,
    addressCkb: input.address?.ckb ?? null,
    phone: input.phone ?? null,
    email: input.email ?? null,
    websiteOrSocial: input.websiteOrSocial ?? null,
    aboutEn: input.about?.en ?? null,
    aboutAr: input.about?.ar ?? null,
    aboutCkb: input.about?.ckb ?? null,
    whyChooseUsEn: input.whyChooseUs?.en ?? null,
    whyChooseUsAr: input.whyChooseUs?.ar ?? null,
    whyChooseUsCkb: input.whyChooseUs?.ckb ?? null,
    active: input.active,
    publiclyVisible,
    tierRank: input.tierRank,
    tierExpiresAt: input.tierExpiresAt ? new Date(input.tierExpiresAt) : null,
    updatedAt: new Date(),
  };

  let facilityId: string;
  if (existing) {
    await tx.update(facilities).set(values).where(eq(facilities.id, existing.id));
    facilityId = existing.id;
  } else {
    const [inserted] = await tx
      .insert(facilities)
      .values(input.id ? { id: input.id, ...values } : values)
      .returning({ id: facilities.id });
    if (!inserted) throw new AppError(ErrorCode.INTERNAL, "Facility insert returned no row");
    facilityId = inserted.id;
  }

  // Media and sections are wholesale-replaced: the input is the full,
  // ordered truth — deterministic under re-runs (seed pipeline reuses this).
  await tx.delete(facilityMedia).where(eq(facilityMedia.facilityId, facilityId));
  if (input.media.length > 0) {
    await tx.insert(facilityMedia).values(
      input.media.map((item) => ({
        facilityId,
        storagePath: item.storagePath,
        sortOrder: item.sortOrder,
        altText: item.alt ?? null,
      })),
    );
  }

  await tx.delete(facilitySections).where(eq(facilitySections.facilityId, facilityId));
  if (input.sections.length > 0) {
    const keys = [...new Set(input.sections.map((section) => section.sectionTypeKey))];
    const typeRows = await tx
      .select({ id: facilitySectionTypes.id, key: facilitySectionTypes.key })
      .from(facilitySectionTypes)
      .where(inArray(facilitySectionTypes.key, keys));
    const typeIdByKey = new Map(typeRows.map((row) => [row.key, row.id]));
    const missing = keys.filter((key) => !typeIdByKey.has(key));
    if (missing.length > 0) {
      throw new AppError(ErrorCode.VALIDATION, `Unknown section types: ${missing.join(", ")}`);
    }
    await tx.insert(facilitySections).values(
      input.sections.map((section) => ({
        facilityId,
        sectionTypeId: typeIdByKey.get(section.sectionTypeKey)!,
        nameEn: section.name.en,
        nameAr: section.name.ar,
        nameCkb: section.name.ckb,
        imagePath: section.imagePath ?? null,
        sortOrder: section.sortOrder,
      })),
    );
  }

  await outbox.emit(tx, {
    name: existing ? "directory.facility_updated.v1" : "directory.facility_created.v1",
    aggregateType: "facility",
    aggregateId: facilityId,
    payload: {
      facilityId,
      slug: input.slug,
      name: packText(input.name.en, input.name.ar, input.name.ckb),
      categorySlug: input.categorySlug,
      citySlug: input.citySlug,
      tierRank: input.tierRank,
      publiclyVisible,
    },
  });

  return { id: facilityId, created: !existing };
}
