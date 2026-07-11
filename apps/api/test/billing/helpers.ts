import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Role } from "@mesomed/contracts/roles";
import { paymentWebhookBodySchema } from "@mesomed/contracts/billing";
import {
  billingCharges,
  billingPolicyEvaluations,
  cities,
  countries,
  doctorProfiles,
  eq,
  providerProfiles,
  user,
} from "@mesomed/db";
import {
  createManualPaymentGateway,
  MANUAL_GATEWAY_ID,
  WebhookVerificationError,
  type PaymentGateway,
} from "@mesomed/platform";
import { buildServer } from "../../src/app.js";
import { testEnv, waitFor } from "../helpers.js";
import {
  nextGuestPhone,
  openSlotsNextWeek,
  seedClinic,
  type ClinicFixture,
} from "../booking/helpers.js";

export { waitFor } from "../helpers.js";
export { appCode } from "../clinical/helpers.js";
export { seedClinic, openSlotsNextWeek, type ClinicFixture } from "../booking/helpers.js";

export interface CallOptions {
  roles?: string;
  user?: string;
  country?: string;
  locale?: string;
}

export const ADMIN = { roles: "admin", user: "admin-under-test" } satisfies CallOptions;

/** Invoke a tRPC procedure through the real HTTP surface. */
export async function trpc(
  app: FastifyInstance,
  procedure: string,
  kind: "query" | "mutation",
  input?: unknown,
  options: CallOptions = {},
) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.roles !== undefined) headers["x-test-roles"] = options.roles;
  if (options.user !== undefined) headers["x-test-user"] = options.user;
  if (options.country !== undefined) headers["x-mesomed-country"] = options.country;
  if (options.locale !== undefined) headers["x-mesomed-locale"] = options.locale;

  if (kind === "query") {
    const query = input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify(input))}`;
    return app.inject({ method: "GET", url: `/trpc/${procedure}${query}`, headers });
  }
  return app.inject({
    method: "POST",
    url: `/trpc/${procedure}`,
    headers,
    payload: input === undefined ? {} : JSON.stringify(input),
  });
}

/** Unwrap a successful tRPC response body. */
export function result<T>(res: { json(): unknown }): T {
  return (res.json() as { result: { data: T } }).result.data;
}

export const TESTPAY_GATEWAY_ID = "testpay";
export const TESTPAY_SECRET = "testpay-webhook-secret-0000";
export const TESTPAY_SIGNATURE_HEADER = "x-testpay-signature";

/** HMAC-SHA256 hex signature over the exact raw body — what testpay expects. */
export function signTestpay(rawBody: string, secret = TESTPAY_SECRET): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

/**
 * Signature-verifying test gateway: the stand-in for a real processor
 * adapter (FIB/ZainCash) so the webhook gate — signature rejection AND
 * idempotent settlement — is proven against the REAL interface. Its raw
 * payload shape happens to be the platform-normalized envelope.
 */
export function createTestpayGateway(): PaymentGateway {
  return {
    id: TESTPAY_GATEWAY_ID,
    isConfigured: () => true,
    async initiatePayment(input) {
      return {
        reference: `${TESTPAY_GATEWAY_ID}:${input.idempotencyKey}`,
        status: "settled",
        redirectUrl: null,
      };
    },
    async verifyPayment(reference) {
      return { reference, status: "settled" };
    },
    async handleWebhook({ rawBody, headers }) {
      const header = headers[TESTPAY_SIGNATURE_HEADER];
      const signature = Array.isArray(header) ? header[0] : header;
      if (!signature) throw new WebhookVerificationError("missing signature header");
      const expected = signTestpay(rawBody);
      const provided = Buffer.from(signature, "utf8");
      const wanted = Buffer.from(expected, "utf8");
      if (provided.length !== wanted.length || !timingSafeEqual(provided, wanted)) {
        throw new WebhookVerificationError("signature mismatch");
      }
      const body = paymentWebhookBodySchema.parse(JSON.parse(rawBody));
      return {
        idempotencyKey: body.idempotencyKey,
        reference: body.reference,
        kind: body.kind,
        amount: body.amount,
        currency: body.currency,
        periods: body.periods,
        facilityId: body.facilityId,
        tierKey: body.tierKey,
        doctorProfileId: body.doctorProfileId,
      };
    },
  };
}

/** A registered-but-unconfigured gateway (adapter present, no credentials). */
export function createUnconfiguredGateway(id: string): PaymentGateway {
  return {
    id,
    isConfigured: () => false,
    async initiatePayment() {
      throw new Error("unconfigured");
    },
    async verifyPayment() {
      throw new Error("unconfigured");
    },
    async handleWebhook() {
      throw new Error("unconfigured");
    },
  };
}

/**
 * Phase 6 test app: real composition root, header-injected sessions (as in
 * the Phase 4/5 suites), and the payment-gateway seam exercised with the
 * production `manual` adapter plus the signature-verifying test gateway.
 * Phase 6b suites inject further fakes through `extraGateways` (a spy for
 * the dormant patient-collection proof; adapters for config-registered
 * gateway ids).
 */
export function buildBillingTestServer(
  connectionString: string,
  extraEnv: NodeJS.ProcessEnv = {},
  extraGateways: Record<string, PaymentGateway> = {},
): Promise<FastifyInstance> {
  return buildServer(testEnv(connectionString, extraEnv), {
    sessionResolver: (req) => {
      const roleHeader = req.headers["x-test-roles"];
      const roles = Array.isArray(roleHeader) ? roleHeader[0] : roleHeader;
      if (roles === undefined) return null;
      const userHeader = req.headers["x-test-user"];
      const userId = (Array.isArray(userHeader) ? userHeader[0] : userHeader) ?? "user-under-test";
      return { userId, roles: roles === "" ? [] : (roles.split(",") as Role[]) };
    },
    paymentGateways: {
      [MANUAL_GATEWAY_ID]: createManualPaymentGateway(),
      [TESTPAY_GATEWAY_ID]: createTestpayGateway(),
      offlinepay: createUnconfiguredGateway("offlinepay"),
      ...extraGateways,
    },
  });
}

/**
 * A settling gateway that records every initiatePayment call — the
 * observable for the dormancy proof ("ZERO gateway calls" while the
 * patient-collection flag is off) and for the flip-activation proof.
 */
export interface SpyGateway extends PaymentGateway {
  initiations: Array<{ idempotencyKey: string; kind: string; amount: number; currency: string }>;
}

export function createSpyGateway(id: string): SpyGateway {
  const initiations: SpyGateway["initiations"] = [];
  return {
    id,
    initiations,
    isConfigured: () => true,
    async initiatePayment(input) {
      initiations.push({
        idempotencyKey: input.idempotencyKey,
        kind: input.kind,
        amount: input.amount,
        currency: input.currency,
      });
      return { reference: `${id}:${input.idempotencyKey}`, status: "settled", redirectUrl: null };
    },
    async verifyPayment(reference) {
      return { reference, status: "settled" };
    },
    async handleWebhook() {
      throw new WebhookVerificationError("spy gateway has no webhook channel");
    },
  };
}

export interface BillingFixture {
  facilityId: string;
  /** Account-backed doctor: identity-approved, subscription-gated. */
  doctorProfileId: string;
  doctorUserId: string;
  /** Admin-curated doctor: no identity account, visible without billing. */
  curatedDoctorProfileId: string;
  doctorSlug: string;
  curatedDoctorSlug: string;
}

let fixtureCounter = 0;

async function adminMutate<T>(app: FastifyInstance, procedure: string, input: unknown): Promise<T> {
  const res = await trpc(app, procedure, "mutation", input, ADMIN);
  if (res.statusCode !== 200) {
    throw new Error(`${procedure} failed in fixture: ${res.statusCode} ${res.body}`);
  }
  return result<T>(res);
}

/**
 * Base taxonomy + tiers + prices + routing + one facility and two doctors.
 * Identity rows are inserted directly (their flows are proven in Phase 2);
 * everything else goes through real admin procedures.
 */
export async function seedBillingFixture(app: FastifyInstance): Promise<BillingFixture> {
  const db = app.kernel.db;
  const n = ++fixtureCounter;
  const suffix = `${process.pid}-${n}`;

  await adminMutate(app, "directory.upsertCountry", {
    slug: `iraq-${suffix}`,
    isoCode: "IQ",
    name: { en: "Iraq", ar: "العراق", ckb: "عێراق" },
  });
  await adminMutate(app, "directory.setCountryGating", { isoCode: "IQ", status: "active" });
  await adminMutate(app, "directory.upsertCity", {
    slug: `erbil-${suffix}`,
    countrySlug: `iraq-${suffix}`,
    name: { en: "Erbil", ar: "أربيل", ckb: "هەولێر" },
  });
  await adminMutate(app, "directory.upsertCategory", {
    slug: `hospital-${suffix}`,
    name: { en: "Hospitals", ar: "مستشفيات", ckb: "نەخۆشخانەکان" },
  });
  await adminMutate(app, "directory.upsertSpecialty", {
    key: `cardiology-${suffix}`,
    name: { en: "Cardiology", ar: "أمراض القلب", ckb: "نەخۆشییەکانی دڵ" },
  });

  // Listing tiers + IQ pricing (data rows, §3.9).
  for (const [key, rank, amount] of [
    [`tier_1`, 1, 150_000],
    [`tier_2`, 2, 90_000],
    [`tier_3`, 3, 30_000],
  ] as const) {
    await adminMutate(app, "billing.upsertListingTier", {
      key,
      rank,
      name: { en: `Tier ${rank}`, ar: `الفئة ${rank}`, ckb: `پلە ${rank}` },
    });
    await adminMutate(app, "billing.setTierPrice", {
      tierKey: key,
      countryCode: "IQ",
      currency: "IQD",
      amount,
    });
  }

  // Route IQ payments to the manual gateway (config row, §3.9).
  for (const kind of ["tier_payment", "subscription"] as const) {
    await adminMutate(app, "billing.setPaymentRouting", {
      countryCode: "IQ",
      kind,
      gateway: MANUAL_GATEWAY_ID,
    });
  }

  const facility = await adminMutate<{ id: string }>(app, "directory.upsertFacility", {
    slug: `billing-hospital-${suffix}`,
    categorySlug: `hospital-${suffix}`,
    citySlug: `erbil-${suffix}`,
    name: { en: "Billing Hospital", ar: "مستشفى الفوترة", ckb: "نەخۆشخانەی پارەدان" },
  });

  // Account-backed doctor: approved identity provider profile + listing.
  const doctorUserId = `billing-doctor-${suffix}`;
  await db.insert(user).values({
    id: doctorUserId,
    name: doctorUserId,
    email: `${doctorUserId}@test.mesomed.example`,
    emailVerified: true,
  });
  const [identityProfile] = await db
    .insert(providerProfiles)
    .values({
      userId: doctorUserId,
      providerType: "doctor",
      status: "approved",
      phone: "+9647700000001",
    })
    .returning({ id: providerProfiles.id });

  const doctorSlug = `dr-billed-${suffix}`;
  const doctor = await adminMutate<{ id: string }>(app, "directory.upsertDoctorProfile", {
    slug: doctorSlug,
    name: { en: "Dr. Billed", ar: "د. مدفوع", ckb: "د. پارەدراو" },
    specialtyKey: `cardiology-${suffix}`,
    citySlug: `erbil-${suffix}`,
    identityProfileId: identityProfile!.id,
  });

  const curatedDoctorSlug = `dr-curated-${suffix}`;
  const curated = await adminMutate<{ id: string }>(app, "directory.upsertDoctorProfile", {
    slug: curatedDoctorSlug,
    name: { en: "Dr. Curated", ar: "د. منسق", ckb: "د. هەڵبژێردراو" },
    specialtyKey: `cardiology-${suffix}`,
    citySlug: `erbil-${suffix}`,
  });

  return {
    facilityId: facility.id,
    doctorProfileId: doctor.id,
    doctorUserId,
    curatedDoctorProfileId: curated.id,
    doctorSlug,
    curatedDoctorSlug,
  };
}

let keyCounter = 0;

/** A unique idempotency key per call. */
export function nextIdempotencyKey(prefix = "test"): string {
  return `${prefix}-${process.pid}-${Date.now()}-${++keyCounter}`;
}

// ═══════════════════════════════════════════════════════════════════════
// Phase 6b — revenue-model fixtures. Rides on the Phase 4 clinic fixture
// (real bookings through the real lifecycle) plus admin procedures for
// everything billing owns; identity/directory scaffolding rows are
// inserted directly, as in every prior suite.
// ═══════════════════════════════════════════════════════════════════════

export const RATE_MONTHLY_FEE_MINOR = 50_000_000; // 50,000 IQD in fils
export const RATE_PER_BOOKING_FEE_MINOR = 2_000_000; // 2,000 IQD in fils
export const RATE_COMMISSION_BP = 750; // 7.50%
export const COMMISSION_BOOKING_VALUE_MINOR = 25_000_000; // 25,000 IQD in fils
/** 25,000,000 × 7.5% = 1,875,000 fils. */
export const EXPECTED_COMMISSION_MINOR = 1_875_000;

export interface RevenueFixture {
  /** Clinic whose doctor's provider runs on the commission model. */
  commissionClinic: ClinicFixture;
  /** Clinic whose doctor's provider runs on flat_monthly. */
  flatClinic: ClinicFixture;
  commissionProviderId: string;
  flatProviderId: string;
}

export async function providerIdForDoctorProfile(
  app: FastifyInstance,
  doctorProfileId: string,
): Promise<string> {
  const [row] = await app.kernel.db
    .select({ providerId: doctorProfiles.providerId })
    .from(doctorProfiles)
    .where(eq(doctorProfiles.id, doctorProfileId));
  if (!row) throw new Error(`No doctor profile ${doctorProfileId} in fixture`);
  return row.providerId;
}

/**
 * Rates for the doctor category, two clinics (one per model), and a
 * country/city attached to both doctors so payment routing can resolve a
 * country for charge collection.
 */
export async function seedRevenueFixture(app: FastifyInstance): Promise<RevenueFixture> {
  const db = app.kernel.db;
  const n = ++fixtureCounter;
  const suffix = `rev-${process.pid}-${n}`;

  // Rates are data rows (§3.9), managed only via the admin command.
  await adminMutate(app, "billing.setBillingRate", {
    category: "doctor",
    model: "flat_monthly",
    rateKind: "monthly_fee",
    value: RATE_MONTHLY_FEE_MINOR,
    currency: "IQD",
  });
  await adminMutate(app, "billing.setBillingRate", {
    category: "doctor",
    model: "flat_monthly",
    rateKind: "per_booking_fee",
    value: RATE_PER_BOOKING_FEE_MINOR,
    currency: "IQD",
  });
  await adminMutate(app, "billing.setBillingRate", {
    category: "doctor",
    model: "commission",
    rateKind: "commission_pct",
    value: RATE_COMMISSION_BP,
    currency: "IQD",
  });

  const commissionClinic = await seedClinic(app);
  const flatClinic = await seedClinic(app);
  const commissionProviderId = await providerIdForDoctorProfile(
    app,
    commissionClinic.doctorProfileId,
  );
  const flatProviderId = await providerIdForDoctorProfile(app, flatClinic.doctorProfileId);

  // Geography scaffolding so the doctors resolve to a routable country.
  const [country] = await db
    .insert(countries)
    .values({
      slug: `iraq-${suffix}`,
      isoCode: "IQ",
      nameEn: "Iraq",
      nameAr: "العراق",
      nameCkb: "عێراق",
    })
    .returning({ id: countries.id });
  const [city] = await db
    .insert(cities)
    .values({
      slug: `erbil-${suffix}`,
      countryId: country!.id,
      nameEn: "Erbil",
      nameAr: "أربيل",
      nameCkb: "هەولێر",
    })
    .returning({ id: cities.id });
  for (const doctorProfileId of [commissionClinic.doctorProfileId, flatClinic.doctorProfileId]) {
    await db
      .update(doctorProfiles)
      .set({ cityId: city!.id })
      .where(eq(doctorProfiles.id, doctorProfileId));
  }

  // Model selection through the real admin command (category snapshots
  // from the directory provider type; rates resolve at charge time).
  await adminMutate(app, "billing.setProviderBillingModel", {
    providerId: commissionProviderId,
    model: "commission",
    bookingValueMinor: COMMISSION_BOOKING_VALUE_MINOR,
  });
  await adminMutate(app, "billing.setProviderBillingModel", {
    providerId: flatProviderId,
    model: "flat_monthly",
  });

  return { commissionClinic, flatClinic, commissionProviderId, flatProviderId };
}

// ── Real booking lifecycles (Phase 4 procedures, header sessions) ───────

export function secretarySession(clinic: ClinicFixture): CallOptions {
  return { roles: "secretary", user: clinic.secretaryUserId };
}

export function doctorSession(clinic: ClinicFixture): CallOptions {
  return { roles: "doctor", user: clinic.doctorUserId };
}

let bookingCounter = 0;

async function lifecycleMutate(
  app: FastifyInstance,
  procedure: string,
  input: unknown,
  session?: CallOptions,
): Promise<unknown> {
  const res = await trpc(app, procedure, "mutation", input, session);
  if (res.statusCode !== 200) {
    throw new Error(`${procedure} failed in fixture: ${res.statusCode} ${res.body}`);
  }
  return result(res);
}

export async function bookGuestAppointment(
  app: FastifyInstance,
  clinic: ClinicFixture,
): Promise<string> {
  const slots = await openSlotsNextWeek(app, clinic.doctorLocationId);
  const slot = slots[bookingCounter++ % slots.length];
  if (!slot) throw new Error("No open slot available for fixture booking");
  const booked = (await lifecycleMutate(app, "booking.guestBook", {
    doctorLocationId: clinic.doctorLocationId,
    startsAt: slot.startsAt,
    patient: { fullName: "Billing Patient", phone: nextGuestPhone() },
  })) as { appointmentId: string };
  return booked.appointmentId;
}

/** book → confirm → check-in → start → complete (emits booking.completed.v1). */
export async function completeBooking(app: FastifyInstance, clinic: ClinicFixture) {
  const appointmentId = await bookGuestAppointment(app, clinic);
  await lifecycleMutate(app, "booking.confirm", { appointmentId }, secretarySession(clinic));
  await lifecycleMutate(app, "booking.checkIn", { appointmentId }, secretarySession(clinic));
  await lifecycleMutate(app, "booking.start", { appointmentId }, doctorSession(clinic));
  await lifecycleMutate(app, "booking.complete", { appointmentId }, doctorSession(clinic));
  return appointmentId;
}

/** book → cancel (emits booking.cancelled.v1). */
export async function cancelBooking(app: FastifyInstance, clinic: ClinicFixture) {
  const appointmentId = await bookGuestAppointment(app, clinic);
  await lifecycleMutate(
    app,
    "booking.cancel",
    { appointmentId, reason: "billing test" },
    secretarySession(clinic),
  );
  return appointmentId;
}

/** book → confirm → no-show (emits booking.no_show.v1). */
export async function noShowBooking(app: FastifyInstance, clinic: ClinicFixture) {
  const appointmentId = await bookGuestAppointment(app, clinic);
  await lifecycleMutate(app, "booking.confirm", { appointmentId }, secretarySession(clinic));
  await lifecycleMutate(app, "booking.noShow", { appointmentId }, secretarySession(clinic));
  return appointmentId;
}

/** The charge row accrued for a booking, once the dispatcher delivers. */
export async function waitForBookingCharge(app: FastifyInstance, appointmentId: string) {
  return waitFor(async () => {
    const [row] = await app.kernel.db
      .select()
      .from(billingCharges)
      .where(eq(billingCharges.bookingId, appointmentId));
    return row;
  });
}

/** The policy-evaluation row for a booking, once the dispatcher delivers. */
export async function waitForPolicyEvaluation(app: FastifyInstance, appointmentId: string) {
  return waitFor(async () => {
    const [row] = await app.kernel.db
      .select()
      .from(billingPolicyEvaluations)
      .where(eq(billingPolicyEvaluations.bookingId, appointmentId));
    return row;
  });
}
