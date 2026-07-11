/**
 * Admin taxonomy upserts (MM-PLAN-001 §5 Phase 3): countries, cities,
 * categories, specialties, symptoms (+ specialty map), procedures, section
 * types and the category↔section-type junction. Every mutation emits
 * directory.taxonomy_changed.v1 in the same transaction (§3.2) so read
 * models can react without polling taxonomy tables (§3.1).
 */
import type { z } from "zod";
import type {
  setCategorySectionTypesInputSchema,
  upsertCategoryInputSchema,
  upsertCityInputSchema,
  upsertCountryInputSchema,
  upsertProcedureInputSchema,
  upsertPromotionInputSchema,
  upsertSectionTypeInputSchema,
  upsertSpecialtyInputSchema,
  upsertSymptomInputSchema,
} from "@mesomed/contracts/directory";
import type { TAXONOMY_KINDS } from "@mesomed/contracts/events/directory";
import { ErrorCode } from "@mesomed/contracts/errors";
import {
  categories,
  cities,
  countries,
  eq,
  facilityCategorySectionTypes,
  facilitySectionTypes,
  homepagePromotions,
  inArray,
  procedures,
  specialties,
  symptomSpecialtyMap,
  symptoms,
  type DbTransaction,
} from "@mesomed/db";
import { AppError } from "../../../kernel/errors.js";
import type { OutboxEmitter } from "../../../kernel/outbox.js";
import { requireCategoryId, requireCityId } from "../shared.js";

type TaxonomyKind = (typeof TAXONOMY_KINDS)[number];

/**
 * Deterministic-id option for the seed pipeline (idempotent, deterministic
 * UUIDs — MM-PLAN-001 §5 Phase 3). Never part of the tRPC input contracts;
 * only in-process callers (seeds/imports) can pin ids at create time.
 */
export interface SeedIdOption {
  id?: string;
}

async function emitTaxonomyChanged(
  tx: DbTransaction,
  outbox: OutboxEmitter,
  taxonomy: TaxonomyKind,
  entityId: string,
  key: string,
  created: boolean,
): Promise<void> {
  await outbox.emit(tx, {
    name: "directory.taxonomy_changed.v1",
    aggregateType: taxonomy,
    aggregateId: entityId,
    payload: { taxonomy, entityId, key, action: created ? "created" : "updated" },
  });
}

export async function upsertCountry(
  tx: DbTransaction,
  outbox: OutboxEmitter,
  input: z.output<typeof upsertCountryInputSchema> & SeedIdOption,
): Promise<{ id: string; created: boolean }> {
  const [existing] = await tx
    .select({ id: countries.id })
    .from(countries)
    .where(eq(countries.slug, input.slug))
    .for("update");
  const values = {
    slug: input.slug,
    isoCode: input.isoCode,
    nameEn: input.name.en,
    nameAr: input.name.ar,
    nameCkb: input.name.ckb,
    sortOrder: input.sortOrder,
  };
  let id: string;
  if (existing) {
    await tx.update(countries).set(values).where(eq(countries.id, existing.id));
    id = existing.id;
  } else {
    const [inserted] = await tx
      .insert(countries)
      .values(input.id ? { id: input.id, ...values } : values)
      .returning({ id: countries.id });
    if (!inserted) throw new AppError(ErrorCode.INTERNAL, "Country insert returned no row");
    id = inserted.id;
  }
  await emitTaxonomyChanged(tx, outbox, "country", id, input.slug, !existing);
  return { id, created: !existing };
}

export async function upsertCity(
  tx: DbTransaction,
  outbox: OutboxEmitter,
  input: z.output<typeof upsertCityInputSchema> & SeedIdOption,
): Promise<{ id: string; created: boolean }> {
  const [country] = await tx
    .select({ id: countries.id })
    .from(countries)
    .where(eq(countries.slug, input.countrySlug));
  if (!country) throw new AppError(ErrorCode.NOT_FOUND, `Unknown country "${input.countrySlug}"`);

  const [existing] = await tx
    .select({ id: cities.id })
    .from(cities)
    .where(eq(cities.slug, input.slug))
    .for("update");
  const values = {
    slug: input.slug,
    countryId: country.id,
    nameEn: input.name.en,
    nameAr: input.name.ar,
    nameCkb: input.name.ckb,
    displayOrder: input.displayOrder,
  };
  let id: string;
  if (existing) {
    await tx.update(cities).set(values).where(eq(cities.id, existing.id));
    id = existing.id;
  } else {
    const [inserted] = await tx
      .insert(cities)
      .values(input.id ? { id: input.id, ...values } : values)
      .returning({ id: cities.id });
    if (!inserted) throw new AppError(ErrorCode.INTERNAL, "City insert returned no row");
    id = inserted.id;
  }
  await emitTaxonomyChanged(tx, outbox, "city", id, input.slug, !existing);
  return { id, created: !existing };
}

export async function upsertCategory(
  tx: DbTransaction,
  outbox: OutboxEmitter,
  input: z.output<typeof upsertCategoryInputSchema> & SeedIdOption,
): Promise<{ id: string; created: boolean }> {
  const [existing] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.slug, input.slug))
    .for("update");
  const values = {
    slug: input.slug,
    nameEn: input.name.en,
    nameAr: input.name.ar,
    nameCkb: input.name.ckb,
    iconKey: input.iconKey ?? null,
    displayOrder: input.displayOrder,
  };
  let id: string;
  if (existing) {
    await tx.update(categories).set(values).where(eq(categories.id, existing.id));
    id = existing.id;
  } else {
    const [inserted] = await tx
      .insert(categories)
      .values(input.id ? { id: input.id, ...values } : values)
      .returning({ id: categories.id });
    if (!inserted) throw new AppError(ErrorCode.INTERNAL, "Category insert returned no row");
    id = inserted.id;
  }
  await emitTaxonomyChanged(tx, outbox, "category", id, input.slug, !existing);
  return { id, created: !existing };
}

export async function upsertSpecialty(
  tx: DbTransaction,
  outbox: OutboxEmitter,
  input: z.output<typeof upsertSpecialtyInputSchema> & SeedIdOption,
): Promise<{ id: string; created: boolean }> {
  const [existing] = await tx
    .select({ id: specialties.id })
    .from(specialties)
    .where(eq(specialties.key, input.key))
    .for("update");
  const values = {
    key: input.key,
    nameEn: input.name.en,
    nameAr: input.name.ar,
    nameCkb: input.name.ckb,
    descriptionEn: input.description?.en ?? null,
    descriptionAr: input.description?.ar ?? null,
    descriptionCkb: input.description?.ckb ?? null,
    imageUrl: input.imageUrl ?? null,
    displayOrder: input.displayOrder,
    updatedAt: new Date(),
  };
  let id: string;
  if (existing) {
    await tx.update(specialties).set(values).where(eq(specialties.id, existing.id));
    id = existing.id;
  } else {
    const [inserted] = await tx
      .insert(specialties)
      .values(input.id ? { id: input.id, ...values } : values)
      .returning({ id: specialties.id });
    if (!inserted) throw new AppError(ErrorCode.INTERNAL, "Specialty insert returned no row");
    id = inserted.id;
  }
  await emitTaxonomyChanged(tx, outbox, "specialty", id, input.key, !existing);
  return { id, created: !existing };
}

export async function upsertSymptom(
  tx: DbTransaction,
  outbox: OutboxEmitter,
  input: z.output<typeof upsertSymptomInputSchema> & SeedIdOption,
): Promise<{ id: string; created: boolean }> {
  const specialtyKeys = input.specialties.map((entry) => entry.key);
  if (specialtyKeys.length > 0) {
    const found = await tx
      .select({ key: specialties.key })
      .from(specialties)
      .where(inArray(specialties.key, specialtyKeys));
    const foundKeys = new Set(found.map((row) => row.key));
    const missing = specialtyKeys.filter((key) => !foundKeys.has(key));
    if (missing.length > 0) {
      throw new AppError(ErrorCode.VALIDATION, `Unknown specialties: ${missing.join(", ")}`);
    }
  }

  const [existing] = await tx
    .select({ id: symptoms.id })
    .from(symptoms)
    .where(eq(symptoms.slug, input.slug))
    .for("update");
  const values = {
    slug: input.slug,
    nameEn: input.name.en,
    nameAr: input.name.ar,
    nameCkb: input.name.ckb,
    displayOrder: input.displayOrder,
  };
  let id: string;
  if (existing) {
    await tx.update(symptoms).set(values).where(eq(symptoms.id, existing.id));
    id = existing.id;
  } else {
    const [inserted] = await tx
      .insert(symptoms)
      .values(input.id ? { id: input.id, ...values } : values)
      .returning({ id: symptoms.id });
    if (!inserted) throw new AppError(ErrorCode.INTERNAL, "Symptom insert returned no row");
    id = inserted.id;
  }

  // The map is wholesale-replaced: the input is the full association set.
  await tx.delete(symptomSpecialtyMap).where(eq(symptomSpecialtyMap.symptomId, id));
  if (input.specialties.length > 0) {
    await tx.insert(symptomSpecialtyMap).values(
      input.specialties.map((entry) => ({
        symptomId: id,
        specialtyKey: entry.key,
        weight: entry.weight,
      })),
    );
  }

  await emitTaxonomyChanged(tx, outbox, "symptom", id, input.slug, !existing);
  return { id, created: !existing };
}

export async function upsertProcedure(
  tx: DbTransaction,
  outbox: OutboxEmitter,
  input: z.output<typeof upsertProcedureInputSchema> & SeedIdOption,
): Promise<{ id: string; created: boolean }> {
  const [specialty] = await tx
    .select({ key: specialties.key })
    .from(specialties)
    .where(eq(specialties.key, input.specialtyKey));
  if (!specialty) {
    throw new AppError(ErrorCode.VALIDATION, `Unknown specialty "${input.specialtyKey}"`);
  }

  const [existing] = await tx
    .select({ id: procedures.id })
    .from(procedures)
    .where(eq(procedures.slug, input.slug))
    .for("update");
  const values = {
    slug: input.slug,
    nameEn: input.name.en,
    nameAr: input.name.ar,
    nameCkb: input.name.ckb,
    descriptionEn: input.description?.en ?? null,
    descriptionAr: input.description?.ar ?? null,
    descriptionCkb: input.description?.ckb ?? null,
    specialtyKey: input.specialtyKey,
    displayOrder: input.displayOrder,
  };
  let id: string;
  if (existing) {
    await tx.update(procedures).set(values).where(eq(procedures.id, existing.id));
    id = existing.id;
  } else {
    const [inserted] = await tx
      .insert(procedures)
      .values(input.id ? { id: input.id, ...values } : values)
      .returning({ id: procedures.id });
    if (!inserted) throw new AppError(ErrorCode.INTERNAL, "Procedure insert returned no row");
    id = inserted.id;
  }
  await emitTaxonomyChanged(tx, outbox, "procedure", id, input.slug, !existing);
  return { id, created: !existing };
}

export async function upsertSectionType(
  tx: DbTransaction,
  outbox: OutboxEmitter,
  input: z.output<typeof upsertSectionTypeInputSchema> & SeedIdOption,
): Promise<{ id: string; created: boolean }> {
  const [existing] = await tx
    .select({ id: facilitySectionTypes.id })
    .from(facilitySectionTypes)
    .where(eq(facilitySectionTypes.key, input.key))
    .for("update");
  const values = {
    key: input.key,
    labelEn: input.label.en,
    labelAr: input.label.ar,
    labelCkb: input.label.ckb,
    displayOrder: input.displayOrder,
  };
  let id: string;
  if (existing) {
    await tx
      .update(facilitySectionTypes)
      .set(values)
      .where(eq(facilitySectionTypes.id, existing.id));
    id = existing.id;
  } else {
    const [inserted] = await tx
      .insert(facilitySectionTypes)
      .values(input.id ? { id: input.id, ...values } : values)
      .returning({ id: facilitySectionTypes.id });
    if (!inserted) throw new AppError(ErrorCode.INTERNAL, "Section type insert returned no row");
    id = inserted.id;
  }
  await emitTaxonomyChanged(tx, outbox, "section_type", id, input.key, !existing);
  return { id, created: !existing };
}

export async function setCategorySectionTypes(
  tx: DbTransaction,
  outbox: OutboxEmitter,
  input: z.output<typeof setCategorySectionTypesInputSchema> & SeedIdOption,
): Promise<{ id: string }> {
  const categoryId = await requireCategoryId(tx, input.categorySlug);
  const typeRows =
    input.sectionTypeKeys.length > 0
      ? await tx
          .select({ id: facilitySectionTypes.id, key: facilitySectionTypes.key })
          .from(facilitySectionTypes)
          .where(inArray(facilitySectionTypes.key, input.sectionTypeKeys))
      : [];
  const typeIdByKey = new Map(typeRows.map((row) => [row.key, row.id]));
  const missing = input.sectionTypeKeys.filter((key) => !typeIdByKey.has(key));
  if (missing.length > 0) {
    throw new AppError(ErrorCode.VALIDATION, `Unknown section types: ${missing.join(", ")}`);
  }

  await tx
    .delete(facilityCategorySectionTypes)
    .where(eq(facilityCategorySectionTypes.categoryId, categoryId));
  if (input.sectionTypeKeys.length > 0) {
    await tx.insert(facilityCategorySectionTypes).values(
      input.sectionTypeKeys.map((key, index) => ({
        categoryId,
        sectionTypeId: typeIdByKey.get(key)!,
        displayOrder: index,
      })),
    );
  }

  await emitTaxonomyChanged(tx, outbox, "category", categoryId, input.categorySlug, false);
  return { id: categoryId };
}

export async function upsertPromotion(
  tx: DbTransaction,
  outbox: OutboxEmitter,
  input: z.output<typeof upsertPromotionInputSchema> & SeedIdOption,
): Promise<{ id: string; created: boolean }> {
  const cityId = await requireCityId(tx, input.citySlug);

  // Natural key: (entityType, entityRef, city) — one curated slot per
  // listing per city; re-upserting adjusts ordering/window in place.
  const [existing] = await tx
    .select({ id: homepagePromotions.id })
    .from(homepagePromotions)
    .where(eq(homepagePromotions.entityRef, input.entityRef))
    .for("update");
  const values = {
    entityType: input.entityType,
    categorySlug: input.categorySlug,
    entityRef: input.entityRef,
    cityId,
    active: input.active,
    sortOrder: input.sortOrder,
    promotedUntil: input.promotedUntil ? new Date(input.promotedUntil) : null,
  };
  let id: string;
  if (existing) {
    await tx.update(homepagePromotions).set(values).where(eq(homepagePromotions.id, existing.id));
    id = existing.id;
  } else {
    const [inserted] = await tx
      .insert(homepagePromotions)
      .values(input.id ? { id: input.id, ...values } : values)
      .returning({ id: homepagePromotions.id });
    if (!inserted) throw new AppError(ErrorCode.INTERNAL, "Promotion insert returned no row");
    id = inserted.id;
  }
  await emitTaxonomyChanged(tx, outbox, "promotion", id, input.entityRef, !existing);
  return { id, created: !existing };
}
