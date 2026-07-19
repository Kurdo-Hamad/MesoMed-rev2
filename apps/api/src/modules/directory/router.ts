/**
 * Directory module tRPC surface (MM-PLAN-001 §5 Phase 3). Public reads are
 * country-gated through the config service (§3.9); admin commands are
 * role-guarded by the kernel authz middleware (§3.6 layer a) and run in one
 * transaction with their outbox events (§3.2). All I/O is typed by the
 * contracts package (§3.11/§3.12).
 */
import {
  browseDoctorsInputSchema,
  browseDoctorsOutputSchema,
  browseFacilitiesInputSchema,
  browseFacilitiesOutputSchema,
  detailInputSchema,
  doctorDetailOutputSchema,
  facilityDetailOutputSchema,
  homepageFeedInputSchema,
  homepageFeedOutputSchema,
  listCategoriesOutputSchema,
  listCitiesOutputSchema,
  listCountriesOutputSchema,
  listHomepageTilesOutputSchema,
  listProceduresOutputSchema,
  listSpecialtiesOutputSchema,
  listSymptomsOutputSchema,
  setCategoryDisplayInputSchema,
  setCategoryGatingInputSchema,
  setCategorySectionTypesInputSchema,
  setCountryGatingInputSchema,
  setSpecialtyFeaturedInputSchema,
  setStatusResultSchema,
  setTaxonomyStatusInputSchema,
  upsertCategoryInputSchema,
  upsertCityInputSchema,
  upsertCountryInputSchema,
  upsertDoctorProfileInputSchema,
  upsertFacilityInputSchema,
  upsertProcedureInputSchema,
  upsertPromotionInputSchema,
  upsertResultSchema,
  upsertSectionTypeInputSchema,
  upsertSpecialtyInputSchema,
  upsertSymptomInputSchema,
} from "@mesomed/contracts/directory";
import { ErrorCode } from "@mesomed/contracts/errors";
import { z } from "zod";
import { roleProcedure } from "../../kernel/authz.js";
import { cacheAside } from "../../kernel/cache.js";
import { AppError } from "../../kernel/errors.js";
import { publicProcedure, router } from "../../kernel/trpc.js";
import {
  HOMEPAGE_FEED_TTL_MS,
  TAXONOMY_TTL_MS,
  homepageFeedCacheKey,
  homepageTilesCacheKey,
  taxonomyCacheKey,
} from "./cache.js";
import {
  setCategorySectionTypes,
  upsertCategory,
  upsertCity,
  upsertCountry,
  upsertProcedure,
  upsertPromotion,
  upsertSectionType,
  upsertSpecialty,
  upsertSymptom,
} from "./commands/upsert-taxonomy.js";
import { setSpecialtyFeatured, setTaxonomyStatus } from "./commands/set-taxonomy-status.js";
import { setCategoryDisplay } from "./commands/set-category-display.js";
import { setCategoryGating } from "./commands/set-category-gating.js";
import { setCountryGating } from "./commands/set-country-gating.js";
import { upsertDoctorProfile } from "./commands/upsert-doctor-profile.js";
import { upsertFacility } from "./commands/upsert-facility.js";
import { browseDoctors } from "./queries/browse-doctors.js";
import { browseFacilities } from "./queries/browse-facilities.js";
import { getDoctorDetail } from "./queries/doctor-detail.js";
import { getFacilityDetail } from "./queries/facility-detail.js";
import { getHomepageFeed } from "./queries/homepage-feed.js";
import {
  listCategories,
  listCities,
  listCountries,
  listHomepageTiles,
  listProcedures,
  listSpecialties,
  listSymptoms,
} from "./queries/list-taxonomies.js";
import { assertCountryActive } from "../../kernel/gating.js";

export function createDirectoryRouter() {
  return router({
    // ── Public reads ───────────────────────────────────────────────────
    // Taxonomy lists and the homepage feed are served cache-aside (ADR-0012):
    // short TTL, busted by the module's own events. Taxonomy payloads are
    // locale-independent (localized text is packed per row); the homepage
    // feed is keyed by locale (its featured fill orders by localized name).
    // Browse/detail stay uncached — unbounded filter/cursor key space over
    // cheap indexed queries.
    listCountries: publicProcedure
      .output(listCountriesOutputSchema)
      .query(({ ctx }) =>
        cacheAside(ctx.cache, taxonomyCacheKey("countries"), TAXONOMY_TTL_MS, () =>
          listCountries(ctx.db, ctx.config),
        ),
      ),

    listCities: publicProcedure
      .output(listCitiesOutputSchema)
      .query(({ ctx }) =>
        cacheAside(ctx.cache, taxonomyCacheKey("cities"), TAXONOMY_TTL_MS, () =>
          listCities(ctx.db),
        ),
      ),

    listCategories: publicProcedure
      .output(listCategoriesOutputSchema)
      .query(({ ctx }) =>
        cacheAside(ctx.cache, taxonomyCacheKey("categories"), TAXONOMY_TTL_MS, () =>
          listCategories(ctx.db, ctx.config),
        ),
      ),

    listHomepageTiles: publicProcedure
      .output(listHomepageTilesOutputSchema)
      .query(async ({ ctx }) => {
        await assertCountryActive(ctx.config, ctx.country);
        return cacheAside(ctx.cache, homepageTilesCacheKey(ctx.country), TAXONOMY_TTL_MS, () =>
          listHomepageTiles(ctx.db, ctx.config, ctx.country),
        );
      }),

    listSpecialties: publicProcedure
      .output(listSpecialtiesOutputSchema)
      .query(({ ctx }) =>
        cacheAside(ctx.cache, taxonomyCacheKey("specialties"), TAXONOMY_TTL_MS, () =>
          listSpecialties(ctx.db),
        ),
      ),

    listSymptoms: publicProcedure
      .output(listSymptomsOutputSchema)
      .query(({ ctx }) =>
        cacheAside(ctx.cache, taxonomyCacheKey("symptoms"), TAXONOMY_TTL_MS, () =>
          listSymptoms(ctx.db),
        ),
      ),

    listProcedures: publicProcedure
      .output(listProceduresOutputSchema)
      .query(({ ctx }) =>
        cacheAside(ctx.cache, taxonomyCacheKey("procedures"), TAXONOMY_TTL_MS, () =>
          listProcedures(ctx.db),
        ),
      ),

    browseFacilities: publicProcedure
      .input(browseFacilitiesInputSchema)
      .output(browseFacilitiesOutputSchema)
      .query(async ({ ctx, input }) => {
        await assertCountryActive(ctx.config, ctx.country);
        return browseFacilities(ctx.db, ctx.locale, ctx.country, input);
      }),

    browseDoctors: publicProcedure
      .input(browseDoctorsInputSchema)
      .output(browseDoctorsOutputSchema)
      .query(async ({ ctx, input }) => {
        await assertCountryActive(ctx.config, ctx.country);
        return browseDoctors(ctx.db, ctx.locale, ctx.country, input);
      }),

    facilityDetail: publicProcedure
      .input(detailInputSchema)
      .output(facilityDetailOutputSchema)
      .query(async ({ ctx, input }) => {
        await assertCountryActive(ctx.config, ctx.country);
        const detail = await getFacilityDetail(ctx.db, input.slugOrId);
        if (!detail) throw new AppError(ErrorCode.NOT_FOUND, "Facility not found");
        return detail;
      }),

    doctorDetail: publicProcedure
      .input(detailInputSchema)
      .output(doctorDetailOutputSchema)
      .query(async ({ ctx, input }) => {
        await assertCountryActive(ctx.config, ctx.country);
        const detail = await getDoctorDetail(ctx.db, input.slugOrId);
        if (!detail) throw new AppError(ErrorCode.NOT_FOUND, "Doctor not found");
        return detail;
      }),

    homepageFeed: publicProcedure
      .input(homepageFeedInputSchema)
      .output(homepageFeedOutputSchema)
      .query(async ({ ctx, input }) => {
        await assertCountryActive(ctx.config, ctx.country);
        return cacheAside(
          ctx.cache,
          homepageFeedCacheKey(ctx.locale, ctx.country, input),
          HOMEPAGE_FEED_TTL_MS,
          () => getHomepageFeed(ctx.db, ctx.locale, ctx.country, input),
        );
      }),

    // ── Admin commands (§3.6 layer a: admin only) ──────────────────────
    upsertCountry: roleProcedure("admin")
      .input(upsertCountryInputSchema)
      .output(upsertResultSchema)
      .mutation(({ ctx, input }) =>
        ctx.db.transaction((tx) => upsertCountry(tx, ctx.outbox, input)),
      ),

    setCountryGating: roleProcedure("admin")
      .input(setCountryGatingInputSchema)
      .output(z.object({ isoCode: z.string() }))
      .mutation(({ ctx, input }) => setCountryGating(ctx.config, input)),

    setCategoryGating: roleProcedure("admin")
      .input(setCategoryGatingInputSchema)
      .output(z.object({ slug: z.string() }))
      .mutation(({ ctx, input }) => setCategoryGating(ctx.config, input)),

    setCategoryDisplay: roleProcedure("admin")
      .input(setCategoryDisplayInputSchema)
      .output(z.object({ countryIso: z.string() }))
      .mutation(({ ctx, input }) => setCategoryDisplay(ctx.config, input)),

    upsertCity: roleProcedure("admin")
      .input(upsertCityInputSchema)
      .output(upsertResultSchema)
      .mutation(({ ctx, input }) => ctx.db.transaction((tx) => upsertCity(tx, ctx.outbox, input))),

    upsertCategory: roleProcedure("admin")
      .input(upsertCategoryInputSchema)
      .output(upsertResultSchema)
      .mutation(({ ctx, input }) =>
        ctx.db.transaction((tx) => upsertCategory(tx, ctx.outbox, input)),
      ),

    upsertSpecialty: roleProcedure("admin")
      .input(upsertSpecialtyInputSchema)
      .output(upsertResultSchema)
      .mutation(({ ctx, input }) =>
        ctx.db.transaction((tx) => upsertSpecialty(tx, ctx.outbox, input)),
      ),

    upsertSymptom: roleProcedure("admin")
      .input(upsertSymptomInputSchema)
      .output(upsertResultSchema)
      .mutation(({ ctx, input }) =>
        ctx.db.transaction((tx) => upsertSymptom(tx, ctx.outbox, input)),
      ),

    upsertProcedure: roleProcedure("admin")
      .input(upsertProcedureInputSchema)
      .output(upsertResultSchema)
      .mutation(({ ctx, input }) =>
        ctx.db.transaction((tx) => upsertProcedure(tx, ctx.outbox, input)),
      ),

    upsertSectionType: roleProcedure("admin")
      .input(upsertSectionTypeInputSchema)
      .output(upsertResultSchema)
      .mutation(({ ctx, input }) =>
        ctx.db.transaction((tx) => upsertSectionType(tx, ctx.outbox, input)),
      ),

    setCategorySectionTypes: roleProcedure("admin")
      .input(setCategorySectionTypesInputSchema)
      .output(setStatusResultSchema)
      .mutation(({ ctx, input }) =>
        ctx.db.transaction((tx) => setCategorySectionTypes(tx, ctx.outbox, input)),
      ),

    setTaxonomyStatus: roleProcedure("admin")
      .input(setTaxonomyStatusInputSchema)
      .output(setStatusResultSchema)
      .mutation(({ ctx, input }) =>
        ctx.db.transaction((tx) => setTaxonomyStatus(tx, ctx.outbox, input)),
      ),

    setSpecialtyFeatured: roleProcedure("admin")
      .input(setSpecialtyFeaturedInputSchema)
      .output(setStatusResultSchema)
      .mutation(({ ctx, input }) =>
        ctx.db.transaction((tx) => setSpecialtyFeatured(tx, ctx.outbox, input)),
      ),

    upsertPromotion: roleProcedure("admin")
      .input(upsertPromotionInputSchema)
      .output(upsertResultSchema)
      .mutation(({ ctx, input }) =>
        ctx.db.transaction((tx) => upsertPromotion(tx, ctx.outbox, input)),
      ),

    upsertFacility: roleProcedure("admin")
      .input(upsertFacilityInputSchema)
      .output(upsertResultSchema)
      .mutation(({ ctx, input }) =>
        ctx.db.transaction((tx) => upsertFacility(tx, ctx.outbox, input)),
      ),

    upsertDoctorProfile: roleProcedure("admin")
      .input(upsertDoctorProfileInputSchema)
      .output(upsertResultSchema)
      .mutation(({ ctx, input }) =>
        ctx.db.transaction((tx) => upsertDoctorProfile(tx, ctx.outbox, input)),
      ),
  });
}
