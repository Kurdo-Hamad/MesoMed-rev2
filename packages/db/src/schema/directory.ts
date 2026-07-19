import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Directory module tables (MM-PLAN-001 §5 Phase 3) — owned exclusively by
 * `apps/api/src/modules/directory` (§3.1). They live in this package because
 * drizzle-kit and the migration journal are centralized here (same precedent
 * as the kernel and identity tables; ADR-0004).
 *
 * Shapes reference the old codebase's 29-table schema (salvage manifest §4)
 * redesigned where events/config require: category/section/promotion
 * taxonomies are pure data rows (no Postgres enums — adding a category or
 * promotion kind is a data change, §3.9), and public visibility is a single
 * denormalized `publicly_visible` column recomputed by the directory from
 * its sources (provider approval from identity events now; billing events
 * flip the same column in Phase 6 with zero query changes).
 *
 * Every user-facing name field is trilingual (en/ar/ckb, §3.10).
 */

/** Localized alt text shape shared by media/taxonomy rows. */
export interface LocalizedAltText {
  en: string;
  ar: string;
  ckb: string;
}

// ── Geography ──────────────────────────────────────────────────────────

/**
 * Country taxonomy for the homepage "Where?" selector. Display data only:
 * whether a country is live or `coming_soon` is NOT a column here — gating
 * state is a config row (packages/config `countryGatingSchema`, key
 * `directory.country_gating`) read through the kernel config service, so
 * flipping a country live is pure data (§3.9).
 */
export const countries = pgTable(
  "countries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    isoCode: text("iso_code").notNull(),
    nameEn: text("name_en").notNull(),
    nameAr: text("name_ar").notNull(),
    nameCkb: text("name_ckb").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("countries_slug_unique").on(table.slug),
    uniqueIndex("countries_iso_code_unique").on(table.isoCode),
  ],
);

export const cities = pgTable(
  "cities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    countryId: uuid("country_id")
      .notNull()
      .references(() => countries.id),
    nameEn: text("name_en").notNull(),
    nameAr: text("name_ar").notNull(),
    nameCkb: text("name_ckb").notNull(),
    active: boolean("active").notNull().default(true),
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("cities_slug_unique").on(table.slug),
    index("cities_country_id_idx").on(table.countryId),
  ],
);

// ── Medical taxonomy ───────────────────────────────────────────────────

export const specialties = pgTable(
  "specialties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    nameEn: text("name_en").notNull(),
    nameAr: text("name_ar").notNull(),
    nameCkb: text("name_ckb").notNull(),
    descriptionEn: text("description_en"),
    descriptionAr: text("description_ar"),
    descriptionCkb: text("description_ckb"),
    imageUrl: text("image_url"),
    altText: jsonb("alt_text").$type<LocalizedAltText>(),
    displayOrder: integer("display_order").notNull().default(0),
    featured: boolean("featured").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("specialties_key_unique").on(table.key)],
);

export const symptoms = pgTable(
  "symptoms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    nameEn: text("name_en").notNull(),
    nameAr: text("name_ar").notNull(),
    nameCkb: text("name_ckb").notNull(),
    active: boolean("active").notNull().default(true),
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("symptoms_slug_unique").on(table.slug)],
);

/**
 * `specialtyKey` is a semantic join to `specialties.key` (validated at the
 * command layer), matching the old schema's convention — the specialty row
 * remains admin-editable without cascading FK churn.
 */
export const symptomSpecialtyMap = pgTable(
  "symptom_specialty_map",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    symptomId: uuid("symptom_id")
      .notNull()
      .references(() => symptoms.id, { onDelete: "cascade" }),
    specialtyKey: text("specialty_key").notNull(),
    /** Higher = stronger association; orders multi-specialty results. */
    weight: integer("weight").notNull().default(1),
  },
  (table) => [uniqueIndex("symptom_specialty_map_unique").on(table.symptomId, table.specialtyKey)],
);

export const procedures = pgTable(
  "procedures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    nameEn: text("name_en").notNull(),
    nameAr: text("name_ar").notNull(),
    nameCkb: text("name_ckb").notNull(),
    descriptionEn: text("description_en"),
    descriptionAr: text("description_ar"),
    descriptionCkb: text("description_ckb"),
    specialtyKey: text("specialty_key").notNull(),
    active: boolean("active").notNull().default(true),
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("procedures_slug_unique").on(table.slug)],
);

// ── Listing entities ───────────────────────────────────────────────────

export const DIRECTORY_PROVIDER_TYPES = [
  "doctor",
  "hospital",
  "laboratory",
  "pharmacy",
  "home_nursing",
  "dental_clinic",
  "beauty_center",
  "hair_transplant",
  "weight_management",
  "physiotherapy",
] as const;

/**
 * Directory listing owner. `identityProfileId` points at the identity
 * module's provider_profiles row when the listing belongs to a registered
 * account (no DB-level FK across the module boundary — identity rows are
 * reached via published queries/events only, §3.1); admin-curated listings
 * without an account leave it null. `approved` mirrors the identity
 * approval state (Phase 2 gate: public ⇔ status = approved), synced by the
 * directory's subscriber on identity.provider_status_changed.v1.
 */
export const providers = pgTable(
  "providers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    providerType: text("provider_type", { enum: DIRECTORY_PROVIDER_TYPES }).notNull(),
    identityProfileId: uuid("identity_profile_id"),
    approved: boolean("approved").notNull().default(false),
    /**
     * Mirror of the billing subscription state (active/grace ⇒ true),
     * synced by the directory's billing.subscription_* subscribers — same
     * single-writer discipline as `approved` (Phase 6). Only consulted for
     * account-backed doctors: listings with no identity account have
     * nobody to bill and stay visible on approved + active alone.
     */
    subscriptionActive: boolean("subscription_active").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("providers_identity_profile_id_unique").on(table.identityProfileId),
    check(
      "providers_type_check",
      sql`${table.providerType} in ('doctor', 'hospital', 'laboratory', 'pharmacy', 'home_nursing', 'dental_clinic', 'beauty_center', 'hair_transplant', 'weight_management', 'physiotherapy')`,
    ),
  ],
);

export const doctorProfiles = pgTable(
  "doctor_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => providers.id),
    slug: text("slug").notNull(),
    nameEn: text("name_en").notNull(),
    nameAr: text("name_ar").notNull(),
    nameCkb: text("name_ckb").notNull(),
    bioEn: text("bio_en"),
    bioAr: text("bio_ar"),
    bioCkb: text("bio_ckb"),
    specialtyKey: text("specialty_key").notNull(),
    cityId: uuid("city_id").references(() => cities.id),
    photoUrl: text("photo_url"),
    active: boolean("active").notNull().default(true),
    /**
     * Denormalized public-visibility predicate: providers.approved AND
     * active. Recomputed by directory commands/subscribers only — queries
     * filter on this single column (and Phase 6 billing flips it through
     * the same recompute path with zero query changes).
     */
    publiclyVisible: boolean("publicly_visible").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("doctor_profiles_slug_unique").on(table.slug),
    uniqueIndex("doctor_profiles_provider_id_unique").on(table.providerId),
    index("doctor_profiles_specialty_key_idx")
      .on(table.specialtyKey, table.nameEn)
      .where(sql`${table.publiclyVisible} = true`),
  ],
);

export const facilities = pgTable(
  "facilities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => providers.id),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id),
    slug: text("slug").notNull(),
    nameEn: text("name_en").notNull(),
    nameAr: text("name_ar").notNull(),
    nameCkb: text("name_ckb").notNull(),
    cityId: uuid("city_id")
      .notNull()
      .references(() => cities.id),
    addressEn: text("address_en"),
    addressAr: text("address_ar"),
    addressCkb: text("address_ckb"),
    phone: text("phone"),
    email: text("email"),
    websiteOrSocial: text("website_or_social"),
    aboutEn: text("about_en"),
    aboutAr: text("about_ar"),
    aboutCkb: text("about_ckb"),
    whyChooseUsEn: text("why_choose_us_en"),
    whyChooseUsAr: text("why_choose_us_ar"),
    whyChooseUsCkb: text("why_choose_us_ckb"),
    active: boolean("active").notNull().default(true),
    /** See doctorProfiles.publiclyVisible — same single-writer discipline. */
    publiclyVisible: boolean("publicly_visible").notNull().default(false),
    /**
     * Denormalized tier rank for the stable landing sort (tier_rank ASC,
     * name_<locale> ASC, id ASC — the ported keyset cursor). 3 = default/
     * lowest; the billing module drives changes via events from Phase 6.
     */
    tierRank: integer("tier_rank").notNull().default(3),
    tierExpiresAt: timestamp("tier_expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("facilities_slug_unique").on(table.slug),
    index("facilities_provider_id_idx").on(table.providerId),
    index("facilities_city_id_idx").on(table.cityId),
    // Partial composite keyset indexes: one per locale name column so the
    // landing sort (tier_rank, name_<locale>, id) is served with no Sort
    // node, and city-scoped variants for the city filter (ported from the
    // old 0012 migration's index audit).
    index("facilities_landing_en_idx")
      .on(table.categoryId, table.tierRank, table.nameEn, table.id)
      .where(sql`${table.publiclyVisible} = true`),
    index("facilities_landing_ar_idx")
      .on(table.categoryId, table.tierRank, table.nameAr, table.id)
      .where(sql`${table.publiclyVisible} = true`),
    index("facilities_landing_ckb_idx")
      .on(table.categoryId, table.tierRank, table.nameCkb, table.id)
      .where(sql`${table.publiclyVisible} = true`),
    index("facilities_landing_city_en_idx")
      .on(table.categoryId, table.cityId, table.tierRank, table.nameEn, table.id)
      .where(sql`${table.publiclyVisible} = true`),
    index("facilities_landing_city_ar_idx")
      .on(table.categoryId, table.cityId, table.tierRank, table.nameAr, table.id)
      .where(sql`${table.publiclyVisible} = true`),
    index("facilities_landing_city_ckb_idx")
      .on(table.categoryId, table.cityId, table.tierRank, table.nameCkb, table.id)
      .where(sql`${table.publiclyVisible} = true`),
  ],
);

/**
 * Facility listing categories ('hospital', 'dental_clinic', …): pure data
 * rows — adding a category is a data change, never a deploy (§3.9).
 */
export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    nameEn: text("name_en").notNull(),
    nameAr: text("name_ar").notNull(),
    nameCkb: text("name_ckb").notNull(),
    iconKey: text("icon_key"),
    active: boolean("active").notNull().default(true),
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("categories_slug_unique").on(table.slug)],
);

/**
 * Marketing/listing photos only — public listing media, never clinical
 * documents (those live with the clinical module from Phase 5).
 */
export const facilityMedia = pgTable(
  "facility_media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    facilityId: uuid("facility_id")
      .notNull()
      .references(() => facilities.id, { onDelete: "cascade" }),
    storagePath: text("storage_path").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    altText: jsonb("alt_text").$type<LocalizedAltText>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("facility_media_facility_id_idx").on(table.facilityId, table.sortOrder)],
);

/**
 * Section vocabulary ('department', 'center', 'service'): which categories
 * use which types is data (facilityCategorySectionTypes), not code — detail
 * rendering reads the junction, never hardcodes category logic.
 */
export const facilitySectionTypes = pgTable(
  "facility_section_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    labelEn: text("label_en").notNull(),
    labelAr: text("label_ar").notNull(),
    labelCkb: text("label_ckb").notNull(),
    displayOrder: integer("display_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("facility_section_types_key_unique").on(table.key)],
);

export const facilityCategorySectionTypes = pgTable(
  "facility_category_section_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    sectionTypeId: uuid("section_type_id")
      .notNull()
      .references(() => facilitySectionTypes.id, { onDelete: "cascade" }),
    displayOrder: integer("display_order").notNull().default(0),
  },
  (table) => [
    uniqueIndex("facility_category_section_types_unique").on(table.categoryId, table.sectionTypeId),
  ],
);

export const facilitySections = pgTable(
  "facility_sections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    facilityId: uuid("facility_id")
      .notNull()
      .references(() => facilities.id, { onDelete: "cascade" }),
    sectionTypeId: uuid("section_type_id")
      .notNull()
      .references(() => facilitySectionTypes.id),
    nameEn: text("name_en").notNull(),
    nameAr: text("name_ar").notNull(),
    nameCkb: text("name_ckb").notNull(),
    imagePath: text("image_path"),
    sortOrder: integer("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("facility_sections_facility_id_idx").on(
      table.facilityId,
      table.sectionTypeId,
      table.sortOrder,
    ),
  ],
);

export const PROMOTION_ENTITY_TYPES = ["facility", "doctor"] as const;

/**
 * Curated homepage "Recommended" slots. `entityRef` is a polymorphic slug
 * resolved per entityType at read time — never a FK (a promotion referencing
 * a vanished listing is silently dropped, not an error). Redesigned from the
 * old promotion_category enum to a plain (entityType, categorySlug) pair so
 * new promotable categories are data, not a Postgres enum migration (§3.9).
 */
export const homepagePromotions = pgTable(
  "homepage_promotions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityType: text("entity_type", { enum: PROMOTION_ENTITY_TYPES }).notNull(),
    /** Category/specialty slug the promotion is displayed under. */
    categorySlug: text("category_slug").notNull(),
    entityRef: text("entity_ref").notNull(),
    cityId: uuid("city_id")
      .notNull()
      .references(() => cities.id),
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    promotedUntil: timestamp("promoted_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("homepage_promotions_city_id_idx").on(table.cityId, table.sortOrder),
    check(
      "homepage_promotions_entity_type_check",
      sql`${table.entityType} in ('facility', 'doctor')`,
    ),
  ],
);
