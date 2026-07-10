/**
 * Directory seed (MM-PLAN-001 §5 Phase 3) — the salvaged 4-script pipeline
 * adapted to the per-module Phase 3 schemas. All writes go through the
 * directory module's command functions, so every listing emits its real
 * outbox event and the search read model populates through the same
 * dispatcher path production uses. Idempotent: commands upsert on natural
 * keys with deterministic seed UUIDs pinned at create time — safe to re-run.
 */
import type { Db } from "@mesomed/db";
import type { ConfigService } from "../../src/kernel/config.js";
import type { OutboxEmitter } from "../../src/kernel/outbox.js";
import { setCountryGating } from "../../src/modules/directory/commands/set-country-gating.js";
import { setSpecialtyFeatured } from "../../src/modules/directory/commands/set-taxonomy-status.js";
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
} from "../../src/modules/directory/commands/upsert-taxonomy.js";
import { upsertDoctorProfile } from "../../src/modules/directory/commands/upsert-doctor-profile.js";
import { upsertFacility } from "../../src/modules/directory/commands/upsert-facility.js";
import {
  BEAUTY_CENTERS,
  BEAUTY_SERVICES,
  CATEGORIES,
  CATEGORY_SECTION_TYPES,
  CITIES,
  COUNTRIES,
  DENTAL_CLINICS,
  DENTAL_SERVICES,
  DOCTORS,
  HOSPITAL_CENTERS,
  HOSPITAL_DEPARTMENTS,
  HOSPITALS,
  PLACEHOLDER_IMAGES,
  PROCEDURES,
  PROMOTIONS,
  SECTION_TYPES,
  SPECIALIST_KEYS,
  SPECIALISTS,
  SPECIALTIES,
  SYMPTOMS,
  TIERS,
} from "./data.js";
import { seedUuid } from "./seed-uuid.js";

const DAY = 24 * 60 * 60 * 1000;

export interface SeedDeps {
  db: Db;
  outbox: OutboxEmitter;
  config: ConfigService;
  log?: (message: string) => void;
}

export async function seedDirectory(deps: SeedDeps): Promise<void> {
  const log = deps.log ?? (() => undefined);
  await seedCountriesAndGating(deps, log);
  await seedGeographyAndTaxonomy(deps, log);
  await seedFacilityListings(deps, log);
  await seedDoctorListings(deps, log);
  await seedPromotions(deps, log);
  log("Directory seed complete.");
}

async function seedCountriesAndGating(deps: SeedDeps, log: (m: string) => void): Promise<void> {
  log(`Seeding ${COUNTRIES.length} countries + gating config...`);
  await deps.db.transaction(async (tx) => {
    for (const [index, country] of COUNTRIES.entries()) {
      await upsertCountry(tx, deps.outbox, {
        id: seedUuid("a", index + 1),
        slug: country.slug,
        isoCode: country.iso,
        name: { en: country.en, ar: country.ar, ckb: country.ckb },
        sortOrder: country.order,
      });
    }
  });
  // Gating is the config row, not a table column (§3.9): only Iraq is live.
  for (const country of COUNTRIES) {
    await setCountryGating(deps.config, {
      isoCode: country.iso,
      status: country.active ? "active" : "coming_soon",
    });
  }
}

async function seedGeographyAndTaxonomy(deps: SeedDeps, log: (m: string) => void): Promise<void> {
  log(
    `Seeding ${CITIES.length} cities, ${CATEGORIES.length} categories, ` +
      `${SECTION_TYPES.length} section types, ${SPECIALTIES.length} specialties, ` +
      `${SYMPTOMS.length} symptoms, ${PROCEDURES.length} procedures...`,
  );
  await deps.db.transaction(async (tx) => {
    for (const [index, city] of CITIES.entries()) {
      await upsertCity(tx, deps.outbox, {
        id: seedUuid("b", index + 1),
        slug: city.slug,
        countrySlug: "iraq",
        name: { en: city.en, ar: city.ar, ckb: city.ckb },
        displayOrder: city.order,
      });
    }

    for (const category of CATEGORIES) {
      await upsertCategory(tx, deps.outbox, {
        id: seedUuid("c", category.n),
        slug: category.slug,
        name: { en: category.en, ar: category.ar, ckb: category.ckb },
        iconKey: category.icon,
        displayOrder: category.n,
      });
    }

    for (const sectionType of SECTION_TYPES) {
      await upsertSectionType(tx, deps.outbox, {
        id: seedUuid("c", sectionType.n),
        key: sectionType.key,
        label: { en: sectionType.en, ar: sectionType.ar, ckb: sectionType.ckb },
        displayOrder: sectionType.n - 10,
      });
    }
    for (const category of CATEGORIES) {
      await setCategorySectionTypes(tx, deps.outbox, {
        categorySlug: category.slug,
        sectionTypeKeys: CATEGORY_SECTION_TYPES[category.slug] ?? [],
      });
    }

    for (const [index, specialty] of SPECIALTIES.entries()) {
      await upsertSpecialty(tx, deps.outbox, {
        id: seedUuid("e", index + 1),
        key: specialty.key,
        name: { en: specialty.en, ar: specialty.ar, ckb: specialty.ckb },
        description:
          "desc_en" in specialty
            ? { en: specialty.desc_en, ar: specialty.desc_ar, ckb: specialty.desc_ckb }
            : undefined,
        displayOrder: index,
      });
    }

    for (const [index, symptom] of SYMPTOMS.entries()) {
      await upsertSymptom(tx, deps.outbox, {
        id: seedUuid("1", index + 1),
        slug: symptom.slug,
        name: { en: symptom.en, ar: symptom.ar, ckb: symptom.ckb },
        displayOrder: index,
        specialties: symptom.specialties.map((entry) => ({
          key: entry.key,
          weight: entry.weight,
        })),
      });
    }

    for (const [index, procedure] of PROCEDURES.entries()) {
      await upsertProcedure(tx, deps.outbox, {
        id: seedUuid("2", index + 1),
        slug: procedure.slug,
        name: { en: procedure.en, ar: procedure.ar, ckb: procedure.ckb },
        description: procedure.desc_en
          ? {
              en: procedure.desc_en,
              ar: procedure.desc_ar ?? "",
              ckb: procedure.desc_ckb ?? "",
            }
          : undefined,
        specialtyKey: procedure.specialty_key,
        displayOrder: index,
      });
    }
  });

  // Featured flags mirror the old seed: the first six specialties.
  await deps.db.transaction(async (tx) => {
    for (const [index, specialty] of SPECIALTIES.entries()) {
      await setSpecialtyFeatured(tx, deps.outbox, {
        key: specialty.key,
        featured: index < 6,
      });
    }
  });
}

async function seedFacilityListings(deps: SeedDeps, log: (m: string) => void): Promise<void> {
  const CATEGORY_DATA = {
    hospital: HOSPITALS,
    dental_clinic: DENTAL_CLINICS,
    beauty_center: BEAUTY_CENTERS,
  } as const;
  const PROVIDER_TYPES = {
    hospital: "hospital",
    dental_clinic: "dental_clinic",
    beauty_center: "beauty_center",
  } as const;

  log("Seeding facilities (10 per category: 7 public, 3 hidden)...");
  const now = Date.now();
  let facilityN = 0;
  for (const category of CATEGORIES) {
    const rows = CATEGORY_DATA[category.slug as keyof typeof CATEGORY_DATA];
    for (const [index, listing] of rows.entries()) {
      facilityN++;
      // Visibility mix (ported): 0..6 public; 7..9 hidden (inactive here —
      // the old verified flag is now identity approval, which admin-curated
      // seeds carry by construction). Tier mix: 0,1 tier_1; 2,3 tier_2
      // (3 = expired, demoted at read time); 4.. tier_3.
      const hidden = index >= 7;
      const tier = index <= 1 ? TIERS[0] : index <= 3 ? TIERS[1] : TIERS[2];
      const expired = index === 3;
      const tierExpiresAt =
        tier.rank === 3 ? null : new Date(now + (expired ? -5 : 60) * DAY).toISOString();

      const sectionSpecs =
        category.slug === "hospital"
          ? [
              ...HOSPITAL_DEPARTMENTS.map((section) => ({ ...section, type: "department" })),
              ...HOSPITAL_CENTERS.map((section) => ({ ...section, type: "center" })),
            ]
          : (category.slug === "dental_clinic" ? DENTAL_SERVICES : BEAUTY_SERVICES).map(
              (section) => ({ ...section, type: "service" }),
            );

      await deps.db.transaction(async (tx) => {
        await upsertFacility(tx, deps.outbox, {
          id: seedUuid("d", facilityN),
          providerType: PROVIDER_TYPES[category.slug as keyof typeof PROVIDER_TYPES],
          slug: listing.slug,
          categorySlug: category.slug,
          citySlug: "erbil",
          name: { en: listing.en, ar: listing.ar, ckb: listing.ckb },
          address: {
            en: `${100 + index} Gulan Street, Erbil`,
            ar: `شارع كولان ${100 + index}، أربيل`,
            ckb: `شەقامی گوڵان ${100 + index}، هەولێر`,
          },
          phone: `+964-66-25${String(1000 + facilityN).slice(1)}`,
          email: `info@${listing.slug.replace(/-/g, "")}.example`,
          websiteOrSocial: `https://instagram.com/${listing.slug.replace(/-/g, "_")}`,
          about: {
            en: `${listing.en} serves patients in Erbil with modern equipment and an experienced multilingual team.`,
            ar: `يخدم ${listing.ar} المرضى في أربيل بأحدث الأجهزة وفريق متمرس متعدد اللغات.`,
            ckb: `${listing.ckb} خزمەتی نەخۆشان دەکات لە هەولێر بە ئامێری نوێ و تیمێکی شارەزای فرەزمان.`,
          },
          whyChooseUs: {
            en: "Experienced specialists, modern facilities, and patient-first care.",
            ar: "أخصائيون ذوو خبرة ومرافق حديثة ورعاية تضع المريض أولاً.",
            ckb: "پسپۆڕی بەئەزموون، بینای نوێ، و چاودێری کە نەخۆش لە پێش هەموو شتێکە.",
          },
          active: !hidden,
          tierRank: tier.rank,
          tierExpiresAt,
          media: Array.from({ length: tier.rank === 3 ? 2 : 3 }, (_, m) => ({
            storagePath: PLACEHOLDER_IMAGES[m % PLACEHOLDER_IMAGES.length]!,
            sortOrder: m,
            alt: { en: listing.en, ar: listing.ar, ckb: listing.ckb },
          })),
          sections: sectionSpecs.map((section, s) => ({
            sectionTypeKey: section.type,
            name: { en: section.en, ar: section.ar, ckb: section.ckb },
            imagePath: PLACEHOLDER_IMAGES[s % PLACEHOLDER_IMAGES.length],
            sortOrder: s,
          })),
        });
      });
    }
  }
}

async function seedDoctorListings(deps: SeedDeps, log: (m: string) => void): Promise<void> {
  log(`Seeding ${DOCTORS.length} doctors + specialist listings...`);
  for (const [index, doctor] of DOCTORS.entries()) {
    const pending = "pending" in doctor && doctor.pending === true;
    await deps.db.transaction(async (tx) => {
      await upsertDoctorProfile(tx, deps.outbox, {
        id: seedUuid("f", index + 1),
        slug: doctor.slug,
        name: { en: doctor.en, ar: doctor.ar, ckb: doctor.ckb },
        bio: {
          en: `Experienced ${doctor.specialty.replace("_", " ")} specialist practicing in Erbil.`,
          ar: "أخصائي ذو خبرة يمارس عمله في أربيل.",
          ckb: "پسپۆڕێکی بەئەزموون کە لە هەولێر کاردەکات.",
        },
        specialtyKey: doctor.specialty,
        citySlug: CITIES[index % CITIES.length]!.slug,
        // "Pending" demo doctors are hidden until Phase 2 approval arrives.
        active: !pending,
      });
    });
  }

  let specialistN = 0;
  for (const specialtyKey of SPECIALIST_KEYS) {
    for (const specialist of SPECIALISTS[specialtyKey]) {
      specialistN++;
      const id = seedUuid("f", 100 + specialistN);
      await deps.db.transaction(async (tx) => {
        await upsertDoctorProfile(tx, deps.outbox, {
          id,
          slug: specialist.slug,
          name: { en: specialist.en, ar: specialist.ar, ckb: specialist.ckb },
          bio: {
            en: `Specialist ${specialtyKey.replace("_", " ")} provider in Erbil.`,
            ar: "مزود خدمة متخصص في أربيل.",
            ckb: "دابینکەری پسپۆڕ لە هەولێر.",
          },
          specialtyKey,
          citySlug: "erbil",
          active: true,
        });
      });
    }
  }
}

async function seedPromotions(deps: SeedDeps, log: (m: string) => void): Promise<void> {
  log(`Seeding ${PROMOTIONS.length} homepage promotions...`);
  // Old promotion_category enum → (entityType, categorySlug) pairs.
  const CATEGORY_MAP: Record<
    (typeof PROMOTIONS)[number]["category"],
    { entityType: "facility" | "doctor"; categorySlug: string }
  > = {
    hospitals: { entityType: "facility", categorySlug: "hospital" },
    dentists: { entityType: "facility", categorySlug: "dental_clinic" },
    beauty_centers: { entityType: "facility", categorySlug: "beauty_center" },
    doctors: { entityType: "doctor", categorySlug: "cardiology" },
    labs: { entityType: "doctor", categorySlug: "laboratory" },
    physiotherapy: { entityType: "doctor", categorySlug: "physiotherapy" },
    weight_management: { entityType: "doctor", categorySlug: "weight_management" },
  };
  await deps.db.transaction(async (tx) => {
    for (const promotion of PROMOTIONS) {
      const mapped = CATEGORY_MAP[promotion.category];
      await upsertPromotion(tx, deps.outbox, {
        id: seedUuid("0", promotion.n),
        entityType: mapped.entityType,
        categorySlug: mapped.categorySlug,
        entityRef: promotion.entityRef,
        citySlug: "erbil",
        active: true,
        sortOrder: promotion.n,
        promotedUntil: null,
      });
    }
  });
}
