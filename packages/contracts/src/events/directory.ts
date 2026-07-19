/**
 * Directory module event contracts (MM-PLAN-001 §5 Phase 3). Versioned and
 * additive-only per §3.3 — breaking change = new version.
 *
 * Payloads carry the denormalized snapshot the search module's read models
 * need (names in all three locales, slugs, visibility), so subscribers never
 * join directory tables (§3.1) — the event is the integration surface.
 */
import { z } from "zod";
import { defineEvent } from "./index.js";

/** Trilingual text value — every user-facing directory name field (§3.10). */
export const localizedTextSchema = z.object({
  en: z.string(),
  ar: z.string(),
  ckb: z.string(),
});

export type LocalizedText = z.infer<typeof localizedTextSchema>;

const facilitySnapshotSchema = z.object({
  facilityId: z.string(),
  slug: z.string(),
  name: localizedTextSchema,
  categorySlug: z.string(),
  citySlug: z.string(),
  /** ISO2 of the facility's country (ADR-0055). Additive — absent on pre-slice events. */
  countryIso: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullable()
    .optional(),
  tierRank: z.number().int(),
  /** The public-visibility predicate, already evaluated by the directory. */
  publiclyVisible: z.boolean(),
});

export const facilityCreatedV1 = defineEvent(
  "directory",
  "facility_created",
  1,
  facilitySnapshotSchema,
);

export const facilityUpdatedV1 = defineEvent(
  "directory",
  "facility_updated",
  1,
  facilitySnapshotSchema,
);

const doctorProfileSnapshotSchema = z.object({
  doctorProfileId: z.string(),
  slug: z.string(),
  name: localizedTextSchema,
  specialtyKey: z.string(),
  citySlug: z.string().nullable(),
  /** ISO2 of the doctor's country (ADR-0055); null when no city. Additive — absent on pre-slice events. */
  countryIso: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullable()
    .optional(),
  /** The public-visibility predicate, already evaluated by the directory. */
  publiclyVisible: z.boolean(),
});

export const doctorProfileCreatedV1 = defineEvent(
  "directory",
  "doctor_profile_created",
  1,
  doctorProfileSnapshotSchema,
);

export const doctorProfileUpdatedV1 = defineEvent(
  "directory",
  "doctor_profile_updated",
  1,
  doctorProfileSnapshotSchema,
);

export const TAXONOMY_KINDS = [
  "country",
  "city",
  "category",
  "specialty",
  "symptom",
  "procedure",
  "section_type",
  "promotion",
] as const;

export const TAXONOMY_ACTIONS = [
  "created",
  "updated",
  "activated",
  "deactivated",
  "featured",
  "unfeatured",
] as const;

export const taxonomyChangedV1 = defineEvent(
  "directory",
  "taxonomy_changed",
  1,
  z.object({
    taxonomy: z.enum(TAXONOMY_KINDS),
    entityId: z.string(),
    /** Stable human key of the row (slug or key column). */
    key: z.string(),
    action: z.enum(TAXONOMY_ACTIONS),
  }),
);

/** All directory event contracts, for registry composition in the API. */
export const DIRECTORY_EVENTS = [
  facilityCreatedV1,
  facilityUpdatedV1,
  doctorProfileCreatedV1,
  doctorProfileUpdatedV1,
  taxonomyChangedV1,
] as const;
