/**
 * Directory module API contracts (MM-PLAN-001 §5 Phase 3). Router I/O is
 * typed here so web/mobile share one source of truth (§3.11/§3.12).
 *
 * Name/label fields round-trip all three locales ({ en, ar, ckb }) — the
 * client picks at render time, so RTL/locale switching never refetches.
 */
import { z } from "zod";
import { localizedTextSchema, type LocalizedText } from "./events/directory.js";

export { localizedTextSchema };
export type { LocalizedText };

/**
 * Country gating states (§3.9). The gating schema and config-service loader
 * live in `packages/config`, which imports these constants — contracts stays
 * the single source of truth for values clients switch on.
 */
export const COUNTRY_GATING_STATUSES = ["active", "coming_soon"] as const;
export type CountryGatingStatus = (typeof COUNTRY_GATING_STATUSES)[number];

/** Pack three locale column values into the wire shape. */
export function packText(en: string, ar: string, ckb: string): LocalizedText {
  return { en, ar, ckb };
}

/** As packText, but null when no locale has a value (optional columns). */
export function packOptionalText(
  en: string | null,
  ar: string | null,
  ckb: string | null,
): LocalizedText | null {
  if (en === null && ar === null && ckb === null) return null;
  return { en: en ?? "", ar: ar ?? "", ckb: ckb ?? "" };
}

const optionalLocalizedTextSchema = localizedTextSchema.nullable();

// ── Taxonomy reads ─────────────────────────────────────────────────────

export const countryListItemSchema = z.object({
  id: z.string(),
  slug: z.string(),
  isoCode: z.string(),
  name: localizedTextSchema,
  sortOrder: z.number().int(),
  /** Resolved from the country-gating config row, never a table column. */
  status: z.enum(COUNTRY_GATING_STATUSES),
});

export const listCountriesOutputSchema = z.object({
  countries: z.array(countryListItemSchema),
});

export const cityListItemSchema = z.object({
  id: z.string(),
  slug: z.string(),
  countrySlug: z.string(),
  name: localizedTextSchema,
  active: z.boolean(),
  displayOrder: z.number().int(),
});

export const listCitiesOutputSchema = z.object({ cities: z.array(cityListItemSchema) });

export const categoryListItemSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: localizedTextSchema,
  iconKey: z.string().nullable(),
  active: z.boolean(),
  displayOrder: z.number().int(),
});

export const listCategoriesOutputSchema = z.object({
  categories: z.array(categoryListItemSchema),
});

export const specialtyListItemSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: localizedTextSchema,
  description: optionalLocalizedTextSchema,
  imageUrl: z.string().nullable(),
  displayOrder: z.number().int(),
  featured: z.boolean(),
  active: z.boolean(),
});

export const listSpecialtiesOutputSchema = z.object({
  specialties: z.array(specialtyListItemSchema),
});

export const symptomListItemSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: localizedTextSchema,
  displayOrder: z.number().int(),
  active: z.boolean(),
  specialties: z.array(z.object({ key: z.string(), weight: z.number().int() })),
});

export const listSymptomsOutputSchema = z.object({ symptoms: z.array(symptomListItemSchema) });

export const procedureListItemSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: localizedTextSchema,
  description: optionalLocalizedTextSchema,
  specialtyKey: z.string(),
  displayOrder: z.number().int(),
  active: z.boolean(),
});

export const listProceduresOutputSchema = z.object({
  procedures: z.array(procedureListItemSchema),
});

// ── Browse (keyset pagination via the ported opaque cursor) ───────────

export const browseFacilitiesInputSchema = z.object({
  categorySlug: z.string().min(1).max(100),
  citySlug: z.string().min(1).max(100).optional(),
  cursor: z.string().max(2000).optional(),
  limit: z.number().int().min(1).max(50).default(12),
});

export const facilityCardSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: localizedTextSchema,
  citySlug: z.string(),
  cityName: localizedTextSchema,
  tierRank: z.number().int(),
  /** Effective tier-1 treatment (expired tiers already demoted). */
  featured: z.boolean(),
  photoPath: z.string().nullable(),
});

export const browseFacilitiesOutputSchema = z.object({
  items: z.array(facilityCardSchema),
  nextCursor: z.string().nullable(),
});

export const browseDoctorsInputSchema = z.object({
  specialtyKey: z.string().min(1).max(100).optional(),
  citySlug: z.string().min(1).max(100).optional(),
  cursor: z.string().max(2000).optional(),
  limit: z.number().int().min(1).max(50).default(12),
});

export const doctorCardSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: localizedTextSchema,
  specialtyKey: z.string(),
  specialtyName: localizedTextSchema.nullable(),
  citySlug: z.string().nullable(),
  cityName: optionalLocalizedTextSchema,
  photoUrl: z.string().nullable(),
});

export const browseDoctorsOutputSchema = z.object({
  items: z.array(doctorCardSchema),
  nextCursor: z.string().nullable(),
});

// ── Details ────────────────────────────────────────────────────────────

export const detailInputSchema = z.object({ slugOrId: z.string().min(1).max(200) });

export const facilityDetailSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: localizedTextSchema,
  categorySlug: z.string(),
  categoryName: localizedTextSchema,
  citySlug: z.string(),
  cityName: localizedTextSchema,
  address: optionalLocalizedTextSchema,
  phone: z.string().nullable(),
  email: z.string().nullable(),
  websiteOrSocial: z.string().nullable(),
  about: optionalLocalizedTextSchema,
  whyChooseUs: optionalLocalizedTextSchema,
  tierRank: z.number().int(),
  featured: z.boolean(),
  media: z.array(
    z.object({
      path: z.string(),
      alt: localizedTextSchema.nullable(),
    }),
  ),
  sections: z.array(
    z.object({
      id: z.string(),
      sectionTypeKey: z.string(),
      sectionTypeLabel: localizedTextSchema,
      name: localizedTextSchema,
      imagePath: z.string().nullable(),
    }),
  ),
});

export const facilityDetailOutputSchema = facilityDetailSchema;

export const doctorDetailOutputSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: localizedTextSchema,
  bio: optionalLocalizedTextSchema,
  specialtyKey: z.string(),
  specialtyName: localizedTextSchema.nullable(),
  citySlug: z.string().nullable(),
  cityName: optionalLocalizedTextSchema,
  photoUrl: z.string().nullable(),
});

// ── Homepage feed ──────────────────────────────────────────────────────

export const homepageFeedInputSchema = z.object({
  citySlug: z.string().min(1).max(100).optional(),
  limit: z.number().int().min(1).max(24).default(8),
});

export const homepageSlotSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("facility"),
    categorySlug: z.string(),
    /** True when the slot came from a paid promotion, not tier ranking. */
    promoted: z.boolean(),
    facility: facilityCardSchema,
  }),
  z.object({
    kind: z.literal("doctor"),
    categorySlug: z.string(),
    promoted: z.boolean(),
    doctor: doctorCardSchema,
  }),
]);

export const homepageFeedOutputSchema = z.object({
  slots: z.array(homepageSlotSchema),
});

// ── Admin commands ─────────────────────────────────────────────────────

export const upsertCountryInputSchema = z.object({
  slug: z.string().min(1).max(100),
  isoCode: z.string().regex(/^[A-Z]{2}$/),
  name: localizedTextSchema,
  sortOrder: z.number().int().min(0).default(0),
});

export const setCountryGatingInputSchema = z.object({
  isoCode: z.string().regex(/^[A-Z]{2}$/),
  status: z.enum(COUNTRY_GATING_STATUSES),
});

export const upsertCityInputSchema = z.object({
  slug: z.string().min(1).max(100),
  countrySlug: z.string().min(1).max(100),
  name: localizedTextSchema,
  displayOrder: z.number().int().min(0).default(0),
});

export const upsertCategoryInputSchema = z.object({
  slug: z.string().min(1).max(100),
  name: localizedTextSchema,
  iconKey: z.string().max(100).optional(),
  displayOrder: z.number().int().min(0).default(0),
});

export const upsertSpecialtyInputSchema = z.object({
  key: z.string().min(1).max(100),
  name: localizedTextSchema,
  description: localizedTextSchema.optional(),
  imageUrl: z.string().max(500).optional(),
  displayOrder: z.number().int().min(0).default(0),
});

export const upsertSymptomInputSchema = z.object({
  slug: z.string().min(1).max(100),
  name: localizedTextSchema,
  displayOrder: z.number().int().min(0).default(0),
  /** Full replacement set for the symptom→specialty map. */
  specialties: z
    .array(z.object({ key: z.string().min(1).max(100), weight: z.number().int().min(1).max(10) }))
    .max(20),
});

export const upsertProcedureInputSchema = z.object({
  slug: z.string().min(1).max(100),
  name: localizedTextSchema,
  description: localizedTextSchema.optional(),
  specialtyKey: z.string().min(1).max(100),
  displayOrder: z.number().int().min(0).default(0),
});

export const upsertSectionTypeInputSchema = z.object({
  key: z.string().min(1).max(100),
  label: localizedTextSchema,
  displayOrder: z.number().int().min(0).default(0),
});

export const setCategorySectionTypesInputSchema = z.object({
  categorySlug: z.string().min(1).max(100),
  /** Full replacement, in display order. */
  sectionTypeKeys: z.array(z.string().min(1).max(100)).max(20),
});

export const GATEABLE_TAXONOMIES = [
  "city",
  "category",
  "specialty",
  "symptom",
  "procedure",
  "section_type",
] as const;

export const setTaxonomyStatusInputSchema = z.object({
  taxonomy: z.enum(GATEABLE_TAXONOMIES),
  key: z.string().min(1).max(100),
  active: z.boolean(),
});

export const setSpecialtyFeaturedInputSchema = z.object({
  key: z.string().min(1).max(100),
  featured: z.boolean(),
});

export const upsertPromotionInputSchema = z.object({
  entityType: z.enum(["facility", "doctor"]),
  categorySlug: z.string().min(1).max(100),
  entityRef: z.string().min(1).max(200),
  citySlug: z.string().min(1).max(100),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).default(0),
  promotedUntil: z.iso.datetime().nullable().optional(),
});

export const upsertFacilityInputSchema = z.object({
  slug: z.string().min(1).max(200),
  categorySlug: z.string().min(1).max(100),
  citySlug: z.string().min(1).max(100),
  name: localizedTextSchema,
  address: localizedTextSchema.optional(),
  phone: z.string().max(50).optional(),
  email: z.email().optional(),
  websiteOrSocial: z.string().max(500).optional(),
  about: localizedTextSchema.optional(),
  whyChooseUs: localizedTextSchema.optional(),
  active: z.boolean().default(true),
  /** Admin-set until billing drives tiers via events (Phase 6). */
  tierRank: z.number().int().min(1).max(3).default(3),
  tierExpiresAt: z.iso.datetime().nullable().optional(),
  /** Identity provider profile that owns this listing; null = admin-curated. */
  identityProfileId: z.uuid().optional(),
  media: z
    .array(
      z.object({
        storagePath: z.string().min(1).max(500),
        sortOrder: z.number().int().min(0).default(0),
        alt: localizedTextSchema.optional(),
      }),
    )
    .max(30)
    .default([]),
  sections: z
    .array(
      z.object({
        sectionTypeKey: z.string().min(1).max(100),
        name: localizedTextSchema,
        imagePath: z.string().max(500).optional(),
        sortOrder: z.number().int().min(0).default(0),
      }),
    )
    .max(50)
    .default([]),
});

export const upsertDoctorProfileInputSchema = z.object({
  slug: z.string().min(1).max(200),
  name: localizedTextSchema,
  bio: localizedTextSchema.optional(),
  specialtyKey: z.string().min(1).max(100),
  citySlug: z.string().min(1).max(100).optional(),
  photoUrl: z.string().max(500).optional(),
  active: z.boolean().default(true),
  /** Identity provider profile that owns this listing; null = admin-curated. */
  identityProfileId: z.uuid().optional(),
});

export const upsertResultSchema = z.object({
  id: z.string(),
  created: z.boolean(),
});

export const setStatusResultSchema = z.object({ id: z.string() });
