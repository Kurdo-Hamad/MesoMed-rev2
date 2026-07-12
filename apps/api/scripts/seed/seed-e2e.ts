/**
 * E2E fixtures on top of the directory seed (Phase 8 Playwright suite):
 * a bookable schedule for the first seeded doctor, a real admin account,
 * a pending provider with a linked (hidden) directory listing for the
 * verification→visibility flow, and the billing config the tier-payment
 * flow needs (listing tier + IQ price + manual-gateway routing). Only
 * ever invoked by the dev-embedded harness (E2E_FIXTURES=1) — never in
 * production; idempotency is irrelevant because the harness's embedded
 * database is created fresh per run.
 */
import type { Db } from "@mesomed/db";
import { eq, providerProfiles, user, userRoles } from "@mesomed/db";
import type { ConfigService } from "../../src/kernel/config.js";
import type { OutboxEmitter } from "../../src/kernel/outbox.js";
import type { IdentityModule } from "../../src/modules/identity/index.js";
import type { PaymentGatewayRegistry } from "../../src/modules/billing/shared.js";
import {
  setPaymentRouting,
  setTierPrice,
  upsertListingTier,
} from "../../src/modules/billing/commands/tier-admin.js";
import { upsertDoctorProfile } from "../../src/modules/directory/commands/upsert-doctor-profile.js";
import { linkDoctorLocation } from "../../src/modules/scheduling/commands/link-doctor-location.js";
import { setWeeklySchedule } from "../../src/modules/scheduling/commands/set-weekly-schedule.js";
import { upsertLocation } from "../../src/modules/scheduling/commands/upsert-location.js";
import { seedUuid } from "./seed-uuid.js";

export const E2E_ADMIN = {
  email: "admin@e2e.mesomed.example",
  password: "E2ePassword!234",
  name: "E2E Admin",
} as const;

export const E2E_PENDING_PROVIDER = {
  email: "pending-provider@e2e.mesomed.example",
  password: "E2ePassword!234",
  name: "Dr. Pending Provider",
  phone: "+9647709990001",
  listingSlug: "dr-pending-provider",
  listingNameEn: "Dr. Pending Provider",
} as const;

/** First seeded doctor (seed-directory `DOCTORS[0]`) becomes bookable. */
export const E2E_BOOKABLE_DOCTOR = {
  doctorProfileId: seedUuid("f", 1),
  slug: "dr-ahmed-doctor",
} as const;

export interface SeedE2eDeps {
  db: Db;
  config: ConfigService;
  outbox: OutboxEmitter;
  identity: IdentityModule;
  paymentGateways: PaymentGatewayRegistry;
  log?: (message: string) => void;
}

async function createAccount(
  identity: IdentityModule,
  db: Db,
  account: { email: string; password: string; name: string },
  roles: readonly ("patient" | "doctor" | "secretary" | "admin")[],
): Promise<string> {
  await identity.auth.api.signUpEmail({
    body: { email: account.email, password: account.password, name: account.name },
  });
  const [row] = await db.select({ id: user.id }).from(user).where(eq(user.email, account.email));
  if (!row) throw new Error(`E2E account "${account.email}" did not persist`);
  // The auth config requires verified email for sign-in; fixtures verify
  // directly — the OTP/email verification flows are proven in Phase 2.
  await db.update(user).set({ emailVerified: true }).where(eq(user.id, row.id));
  for (const role of roles) {
    await db.insert(userRoles).values({ userId: row.id, role }).onConflictDoNothing();
  }
  return row.id;
}

export async function seedE2eFixtures(deps: SeedE2eDeps): Promise<void> {
  const log = deps.log ?? (() => undefined);

  log("E2E: creating admin account...");
  await createAccount(deps.identity, deps.db, E2E_ADMIN, ["admin"]);

  log("E2E: making the first seeded doctor bookable...");
  await deps.db.transaction(async (tx) => {
    const location = await upsertLocation(tx, {
      slug: "e2e-clinic-erbil",
      name: { en: "E2E Clinic", ar: "عيادة الاختبار", ckb: "کلینیکی تاقیکردنەوە" },
      timeZone: "Asia/Baghdad",
      active: true,
    });
    const link = await linkDoctorLocation(tx, {
      doctorProfileId: E2E_BOOKABLE_DOCTOR.doctorProfileId,
      locationId: location.id,
      active: true,
    });
    await setWeeklySchedule(tx, {
      doctorLocationId: link.doctorLocationId,
      schedules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
        dayOfWeek,
        startTime: "09:00",
        endTime: "17:00",
        slotDurationMinutes: 30,
        breaks: [],
      })),
    });
  });

  log("E2E: creating pending provider + hidden listing...");
  const providerUserId = await createAccount(deps.identity, deps.db, E2E_PENDING_PROVIDER, []);
  const [providerProfile] = await deps.db
    .insert(providerProfiles)
    .values({
      userId: providerUserId,
      providerType: "doctor",
      status: "pending",
      phone: E2E_PENDING_PROVIDER.phone,
    })
    .returning({ id: providerProfiles.id });
  await deps.db.transaction(async (tx) => {
    await upsertDoctorProfile(tx, deps.outbox, {
      id: seedUuid("f", 900),
      slug: E2E_PENDING_PROVIDER.listingSlug,
      name: {
        en: E2E_PENDING_PROVIDER.listingNameEn,
        ar: "د. قيد المراجعة",
        ckb: "د. چاوەڕوانی پێداچوونەوە",
      },
      specialtyKey: "cardiology",
      citySlug: "erbil",
      active: true,
      identityProfileId: providerProfile!.id,
    });
  });

  log("E2E: billing tier + price + manual routing...");
  await deps.db.transaction(async (tx) => {
    await upsertListingTier(tx, {
      key: "tier_1",
      rank: 1,
      name: { en: "Tier 1 — Featured", ar: "الفئة ١", ckb: "پلەی ١" },
      active: true,
    });
    await setTierPrice(tx, {
      tierKey: "tier_1",
      countryCode: "IQ",
      currency: "IQD",
      amount: 100_000,
      active: true,
    });
  });
  await setPaymentRouting(deps.config, deps.paymentGateways, {
    countryCode: "IQ",
    kind: "tier_payment",
    gateway: "manual",
  });
  await setPaymentRouting(deps.config, deps.paymentGateways, {
    countryCode: "IQ",
    kind: "subscription",
    gateway: "manual",
  });

  log("E2E fixtures ready.");
}
