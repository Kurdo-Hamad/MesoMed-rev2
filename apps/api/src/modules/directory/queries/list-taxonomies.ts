/**
 * Public taxonomy reads (MM-PLAN-001 §5 Phase 3). Countries compose their
 * gating status from the config row at read time (§3.9) — the table holds
 * display data only, so status can never drift between two sources.
 */
import type { z } from "zod";
import type {
  listCategoriesOutputSchema,
  listCitiesOutputSchema,
  listCountriesOutputSchema,
  listProceduresOutputSchema,
  listSpecialtiesOutputSchema,
  listSymptomsOutputSchema,
} from "@mesomed/contracts/directory";
import {
  COUNTRY_GATING_CONFIG_KEY,
  countryGatingSchema,
  type CountryGating,
} from "@mesomed/config";
import {
  asc,
  categories,
  cities,
  countries,
  eq,
  procedures,
  specialties,
  symptomSpecialtyMap,
  symptoms,
  type Db,
} from "@mesomed/db";
import type { ConfigService } from "../../../kernel/config.js";
import { packOptionalText, packText } from "../shared.js";

export async function listCountries(
  db: Db,
  config: ConfigService,
): Promise<z.output<typeof listCountriesOutputSchema>> {
  let gating: CountryGating = {};
  try {
    gating = await config.get(countryGatingSchema, COUNTRY_GATING_CONFIG_KEY);
  } catch (error) {
    if ((error as { code?: string }).code !== "NOT_FOUND") throw error;
  }
  const rows = await db
    .select()
    .from(countries)
    .orderBy(asc(countries.sortOrder), asc(countries.slug));
  return {
    countries: rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      isoCode: row.isoCode,
      name: packText(row.nameEn, row.nameAr, row.nameCkb),
      sortOrder: row.sortOrder,
      status: gating[row.isoCode] ?? "coming_soon",
    })),
  };
}

export async function listCities(db: Db): Promise<z.output<typeof listCitiesOutputSchema>> {
  const rows = await db
    .select({
      id: cities.id,
      slug: cities.slug,
      countrySlug: countries.slug,
      nameEn: cities.nameEn,
      nameAr: cities.nameAr,
      nameCkb: cities.nameCkb,
      active: cities.active,
      displayOrder: cities.displayOrder,
    })
    .from(cities)
    .innerJoin(countries, eq(countries.id, cities.countryId))
    .where(eq(cities.active, true))
    .orderBy(asc(cities.displayOrder), asc(cities.slug));
  return {
    cities: rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      countrySlug: row.countrySlug,
      name: packText(row.nameEn, row.nameAr, row.nameCkb),
      active: row.active,
      displayOrder: row.displayOrder,
    })),
  };
}

export async function listCategories(db: Db): Promise<z.output<typeof listCategoriesOutputSchema>> {
  const rows = await db
    .select()
    .from(categories)
    .where(eq(categories.active, true))
    .orderBy(asc(categories.displayOrder), asc(categories.slug));
  return {
    categories: rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: packText(row.nameEn, row.nameAr, row.nameCkb),
      iconKey: row.iconKey,
      active: row.active,
      displayOrder: row.displayOrder,
    })),
  };
}

export async function listSpecialties(
  db: Db,
): Promise<z.output<typeof listSpecialtiesOutputSchema>> {
  const rows = await db
    .select()
    .from(specialties)
    .where(eq(specialties.active, true))
    .orderBy(asc(specialties.displayOrder), asc(specialties.key));
  return {
    specialties: rows.map((row) => ({
      id: row.id,
      key: row.key,
      name: packText(row.nameEn, row.nameAr, row.nameCkb),
      description: packOptionalText(row.descriptionEn, row.descriptionAr, row.descriptionCkb),
      imageUrl: row.imageUrl,
      displayOrder: row.displayOrder,
      featured: row.featured,
      active: row.active,
    })),
  };
}

export async function listSymptoms(db: Db): Promise<z.output<typeof listSymptomsOutputSchema>> {
  const rows = await db
    .select()
    .from(symptoms)
    .where(eq(symptoms.active, true))
    .orderBy(asc(symptoms.displayOrder), asc(symptoms.slug));
  const mappings = await db
    .select({
      symptomId: symptomSpecialtyMap.symptomId,
      key: symptomSpecialtyMap.specialtyKey,
      weight: symptomSpecialtyMap.weight,
    })
    .from(symptomSpecialtyMap);
  const bySymptom = new Map<string, { key: string; weight: number }[]>();
  for (const mapping of mappings) {
    const list = bySymptom.get(mapping.symptomId) ?? [];
    list.push({ key: mapping.key, weight: mapping.weight });
    bySymptom.set(mapping.symptomId, list);
  }
  return {
    symptoms: rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: packText(row.nameEn, row.nameAr, row.nameCkb),
      displayOrder: row.displayOrder,
      active: row.active,
      specialties: (bySymptom.get(row.id) ?? []).sort((a, b) => b.weight - a.weight),
    })),
  };
}

export async function listProcedures(db: Db): Promise<z.output<typeof listProceduresOutputSchema>> {
  const rows = await db
    .select()
    .from(procedures)
    .where(eq(procedures.active, true))
    .orderBy(asc(procedures.displayOrder), asc(procedures.slug));
  return {
    procedures: rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: packText(row.nameEn, row.nameAr, row.nameCkb),
      description: packOptionalText(row.descriptionEn, row.descriptionAr, row.descriptionCkb),
      specialtyKey: row.specialtyKey,
      displayOrder: row.displayOrder,
      active: row.active,
    })),
  };
}
