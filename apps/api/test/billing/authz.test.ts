import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import { createBillingRouter } from "../../src/modules/billing/router.js";
import {
  ADMIN,
  appCode,
  buildBillingTestServer,
  nextIdempotencyKey,
  seedBillingFixture,
  trpc,
  type BillingFixture,
} from "./helpers.js";

/**
 * Per-procedure role-guard denial matrix for the billing router (§3.6
 * layer a; MM-QA-004 F-07) with the enumeration pin proving the guardrail
 * itself: EVERY procedure must appear in the matrix, so a new procedure
 * cannot ship without denial coverage (HANDOFF-001 #14). Plus
 * invariant-violation coverage (§3.12: happy paths live in the
 * tier-payment/subscription/webhook suites).
 */
describe("billing router authz + invariants", () => {
  let tdb: TestDatabase;
  let app: FastifyInstance;
  let fx: BillingFixture;

  beforeAll(async () => {
    tdb = await createTestDatabase();
    app = await buildBillingTestServer(tdb.connectionString);
    await app.ready();
    fx = await seedBillingFixture(app);
  });

  afterAll(async () => {
    await app.close();
    await tdb.close();
  });

  interface MatrixEntry {
    procedure: string;
    kind: "query" | "mutation";
    input?: unknown;
    /** Roles denied by the kernel role guard (layer a) → 403. */
    deniedRoles: string[];
    /** Public procedures assert the absence of an auth gate instead of 401. */
    access?: "public";
  }

  // The kernel role guard fires before input parsing, so guarded entries
  // need no input; only the public entry actually reaches its handler.
  const ADMIN_ONLY = ["patient", "doctor", "secretary"];
  const DOCTOR_ONLY = ["patient", "secretary", "admin"];
  const DOCTOR_OR_ADMIN = ["patient", "secretary"];

  const MATRIX: MatrixEntry[] = [
    { procedure: "billing.listTiers", kind: "query", deniedRoles: [], access: "public" },
    { procedure: "billing.mySubscription", kind: "query", deniedRoles: DOCTOR_ONLY },
    { procedure: "billing.upsertListingTier", kind: "mutation", deniedRoles: ADMIN_ONLY },
    { procedure: "billing.setTierPrice", kind: "mutation", deniedRoles: ADMIN_ONLY },
    { procedure: "billing.setPaymentRouting", kind: "mutation", deniedRoles: ADMIN_ONLY },
    { procedure: "billing.recordTierPayment", kind: "mutation", deniedRoles: ADMIN_ONLY },
    { procedure: "billing.recordSubscriptionPayment", kind: "mutation", deniedRoles: ADMIN_ONLY },
    { procedure: "billing.expireSubscription", kind: "mutation", deniedRoles: ADMIN_ONLY },
    { procedure: "billing.facilityTierState", kind: "query", deniedRoles: ADMIN_ONLY },
    { procedure: "billing.setBillingRate", kind: "mutation", deniedRoles: ADMIN_ONLY },
    { procedure: "billing.listBillingRates", kind: "query", deniedRoles: ADMIN_ONLY },
    {
      procedure: "billing.setProviderBillingModel",
      kind: "mutation",
      deniedRoles: DOCTOR_OR_ADMIN,
    },
    { procedure: "billing.myBillingConfig", kind: "query", deniedRoles: DOCTOR_ONLY },
    { procedure: "billing.providerBillingConfig", kind: "query", deniedRoles: ADMIN_ONLY },
    { procedure: "billing.setCancellationPolicy", kind: "mutation", deniedRoles: DOCTOR_OR_ADMIN },
    { procedure: "billing.myCancellationPolicy", kind: "query", deniedRoles: DOCTOR_ONLY },
    { procedure: "billing.myCharges", kind: "query", deniedRoles: DOCTOR_ONLY },
    { procedure: "billing.providerCharges", kind: "query", deniedRoles: ADMIN_ONLY },
    { procedure: "billing.settleCharge", kind: "mutation", deniedRoles: ADMIN_ONLY },
    { procedure: "billing.voidCharge", kind: "mutation", deniedRoles: ADMIN_ONLY },
    { procedure: "billing.refundCharge", kind: "mutation", deniedRoles: ADMIN_ONLY },
    { procedure: "billing.accrueSubscriptionFee", kind: "mutation", deniedRoles: ADMIN_ONLY },
    { procedure: "billing.setTrialDefault", kind: "mutation", deniedRoles: ADMIN_ONLY },
    {
      procedure: "billing.setPatientCollectionEnabled",
      kind: "mutation",
      deniedRoles: ADMIN_ONLY,
    },
    { procedure: "billing.registerPaymentGateway", kind: "mutation", deniedRoles: ADMIN_ONLY },
  ];

  it("meta-test: EVERY billing procedure appears in the denial matrix", () => {
    // Router construction only wires closures — enumeration stubs are safe.
    const record = createBillingRouter({ gateways: {} })._def.procedures as Record<string, unknown>;
    const procedures = Object.keys(record)
      .map((name) => `billing.${name}`)
      .sort();
    expect(procedures).toEqual(MATRIX.map((e) => e.procedure).sort());
  });

  for (const entry of MATRIX) {
    if (entry.access === "public") {
      it(`${entry.procedure}: public — anonymous caller is not auth-gated`, async () => {
        const res = await trpc(app, entry.procedure, entry.kind, entry.input);
        expect([401, 403]).not.toContain(res.statusCode);
      });
    } else {
      it(`${entry.procedure}: anonymous → 401 UNAUTHORIZED`, async () => {
        const res = await trpc(app, entry.procedure, entry.kind, entry.input);
        expect(res.statusCode).toBe(401);
        expect(appCode(res)).toBe("UNAUTHORIZED");
      });
    }

    for (const role of entry.deniedRoles) {
      it(`${entry.procedure}: ${role} → 403 FORBIDDEN`, async () => {
        const res = await trpc(app, entry.procedure, entry.kind, entry.input, {
          roles: role,
          user: "intruder",
        });
        expect(res.statusCode).toBe(403);
        expect(appCode(res)).toBe("FORBIDDEN");
      });
    }
  }

  it("rejects payments for unknown tiers, facilities and doctors (typed)", async () => {
    const badTier = await trpc(
      app,
      "billing.recordTierPayment",
      "mutation",
      { idempotencyKey: nextIdempotencyKey(), facilityId: fx.facilityId, tierKey: "tier_404" },
      ADMIN,
    );
    expect(badTier.statusCode).toBe(400);
    expect(appCode(badTier)).toBe("VALIDATION");

    const badFacility = await trpc(
      app,
      "billing.recordTierPayment",
      "mutation",
      {
        idempotencyKey: nextIdempotencyKey(),
        facilityId: "00000000-0000-4000-8000-000000000000",
        tierKey: "tier_1",
      },
      ADMIN,
    );
    expect(badFacility.statusCode).toBe(404);
    expect(appCode(badFacility)).toBe("NOT_FOUND");

    const badDoctor = await trpc(
      app,
      "billing.recordSubscriptionPayment",
      "mutation",
      {
        idempotencyKey: nextIdempotencyKey(),
        doctorProfileId: "00000000-0000-4000-8000-000000000000",
        amount: 1,
        currency: "IQD",
      },
      ADMIN,
    );
    expect(badDoctor.statusCode).toBe(404);
    expect(appCode(badDoctor)).toBe("NOT_FOUND");
  });

  it("fails closed when no gateway is routed for the request country", async () => {
    // No routing entry exists for JO — typed precondition, not a fallback.
    const res = await trpc(
      app,
      "billing.recordSubscriptionPayment",
      "mutation",
      {
        idempotencyKey: nextIdempotencyKey(),
        doctorProfileId: fx.doctorProfileId,
        amount: 1,
        currency: "IQD",
      },
      { ...ADMIN, country: "JO" },
    );
    expect(res.statusCode).toBe(412);
    expect(appCode(res)).toBe("PAYMENT_GATEWAY_NOT_CONFIGURED");
  });

  it("fails closed when routing points at a registered-but-unconfigured adapter", async () => {
    await trpc(
      app,
      "billing.setPaymentRouting",
      "mutation",
      { countryCode: "SY", kind: "subscription", gateway: "offlinepay" },
      ADMIN,
    );
    const res = await trpc(
      app,
      "billing.recordSubscriptionPayment",
      "mutation",
      {
        idempotencyKey: nextIdempotencyKey(),
        doctorProfileId: fx.doctorProfileId,
        amount: 1,
        currency: "IQD",
      },
      { ...ADMIN, country: "SY" },
    );
    expect(res.statusCode).toBe(412);
    expect(appCode(res)).toBe("PAYMENT_GATEWAY_NOT_CONFIGURED");
  });

  it("rejects routing to a gateway id that is neither registered nor known", async () => {
    const res = await trpc(
      app,
      "billing.setPaymentRouting",
      "mutation",
      { countryCode: "IQ", kind: "tier_payment", gateway: "paypal" },
      ADMIN,
    );
    expect(res.statusCode).toBe(400);
    expect(appCode(res)).toBe("VALIDATION");
  });

  it("accepts routing to interface-ready gateway ids ahead of their adapters", async () => {
    // fib/zaincash are registered ids (§8 deferral): config may stage them,
    // resolution stays fail-closed until an adapter is wired.
    const set = await trpc(
      app,
      "billing.setPaymentRouting",
      "mutation",
      { countryCode: "SY", kind: "tier_payment", gateway: "fib" },
      ADMIN,
    );
    expect(set.statusCode).toBe(200);

    const res = await trpc(
      app,
      "billing.recordTierPayment",
      "mutation",
      { idempotencyKey: nextIdempotencyKey(), facilityId: fx.facilityId, tierKey: "tier_1" },
      { ...ADMIN, country: "SY" },
    );
    expect(res.statusCode).toBe(400);
    expect(appCode(res)).toBe("VALIDATION"); // no SY price row — checked first
  });

  it("rejects expiry transitions that make no sense (typed)", async () => {
    const noSubscription = await trpc(
      app,
      "billing.expireSubscription",
      "mutation",
      { doctorProfileId: fx.curatedDoctorProfileId, toGrace: false },
      ADMIN,
    );
    expect(noSubscription.statusCode).toBe(404);
    expect(appCode(noSubscription)).toBe("NOT_FOUND");

    // Activate, deactivate, then deactivate again / grace from inactive.
    await trpc(
      app,
      "billing.recordSubscriptionPayment",
      "mutation",
      {
        idempotencyKey: nextIdempotencyKey(),
        doctorProfileId: fx.doctorProfileId,
        amount: 1,
        currency: "IQD",
      },
      ADMIN,
    );
    await trpc(
      app,
      "billing.expireSubscription",
      "mutation",
      { doctorProfileId: fx.doctorProfileId, toGrace: false },
      ADMIN,
    );

    const doubleExpire = await trpc(
      app,
      "billing.expireSubscription",
      "mutation",
      { doctorProfileId: fx.doctorProfileId, toGrace: false },
      ADMIN,
    );
    expect(doubleExpire.statusCode).toBe(409);
    expect(appCode(doubleExpire)).toBe("INVALID_STATUS_TRANSITION");

    const graceFromInactive = await trpc(
      app,
      "billing.expireSubscription",
      "mutation",
      { doctorProfileId: fx.doctorProfileId, toGrace: true },
      ADMIN,
    );
    expect(graceFromInactive.statusCode).toBe(409);
    expect(appCode(graceFromInactive)).toBe("INVALID_STATUS_TRANSITION");
  });

  it("rejects a tier payment when the country has no price row (typed)", async () => {
    await trpc(
      app,
      "billing.setPaymentRouting",
      "mutation",
      { countryCode: "EG", kind: "tier_payment", gateway: "manual" },
      ADMIN,
    );
    const res = await trpc(
      app,
      "billing.recordTierPayment",
      "mutation",
      { idempotencyKey: nextIdempotencyKey(), facilityId: fx.facilityId, tierKey: "tier_1" },
      { ...ADMIN, country: "EG" },
    );
    expect(res.statusCode).toBe(400);
    expect(appCode(res)).toBe("VALIDATION");
  });
});
