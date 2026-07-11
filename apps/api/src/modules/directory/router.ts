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
  listProceduresOutputSchema,
  listSpecialtiesOutputSchema,
  listSymptomsOutputSchema,
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
import { AppError } from "../../kernel/errors.js";
import { publicProcedure, router } from "../../kernel/trpc.js";
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
  listProcedures,
  listSpecialties,
  listSymptoms,
} from "./queries/list-taxonomies.js";
import { assertCountryActive } from "../../kernel/gating.js";

export function createDirectoryRouter() {
  return router({
    // ── Public reads ───────────────────────────────────────────────────
    listCountries: publicProcedure
      .output(listCountriesOutputSchema)
      .query(({ ctx }) => listCountries(ctx.db, ctx.config)),

    listCities: publicProcedure
      .output(listCitiesOutputSchema)
      .query(({ ctx }) => listCities(ctx.db)),

    listCategories: publicProcedure
      .output(listCategoriesOutputSchema)
      .query(({ ctx }) => listCategories(ctx.db)),

    listSpecialties: publicProcedure
      .output(listSpecialtiesOutputSchema)
      .query(({ ctx }) => listSpecialties(ctx.db)),

    listSymptoms: publicProcedure
      .output(listSymptomsOutputSchema)
      .query(({ ctx }) => listSymptoms(ctx.db)),

    listProcedures: publicProcedure
      .output(listProceduresOutputSchema)
      .query(({ ctx }) => listProcedures(ctx.db)),

    browseFacilities: publicProcedure
      .input(browseFacilitiesInputSchema)
      .output(browseFacilitiesOutputSchema)
      .query(async ({ ctx, input }) => {
        await assertCountryActive(ctx.config, ctx.country);
        return browseFacilities(ctx.db, ctx.locale, input);
      }),

    browseDoctors: publicProcedure
      .input(browseDoctorsInputSchema)
      .output(browseDoctorsOutputSchema)
      .query(async ({ ctx, input }) => {
        await assertCountryActive(ctx.config, ctx.country);
        return browseDoctors(ctx.db, ctx.locale, input);
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
        return getHomepageFeed(ctx.db, ctx.locale, input);
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
