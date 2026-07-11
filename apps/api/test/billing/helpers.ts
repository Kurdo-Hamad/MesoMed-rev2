import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Role } from "@mesomed/contracts/roles";
import { paymentWebhookBodySchema } from "@mesomed/contracts/billing";
import { providerProfiles, user } from "@mesomed/db";
import {
  createManualPaymentGateway,
  MANUAL_GATEWAY_ID,
  WebhookVerificationError,
  type PaymentGateway,
} from "@mesomed/platform";
import { buildServer } from "../../src/app.js";
import { testEnv } from "../helpers.js";

export { waitFor } from "../helpers.js";
export { appCode } from "../clinical/helpers.js";

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
 */
export function buildBillingTestServer(
  connectionString: string,
  extraEnv: NodeJS.ProcessEnv = {},
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
    },
  });
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
