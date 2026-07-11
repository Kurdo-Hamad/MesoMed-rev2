import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
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
 * Per-command role-guard denial matrix for the billing router (§3.6 layer
 * a) plus invariant-violation coverage (§3.12: happy paths live in the
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

  const NAME = { en: "X", ar: "س", ckb: "خ" };

  function adminCommands(): Array<[string, unknown]> {
    return [
      ["upsertListingTier", { key: "tier_x", rank: 9, name: NAME }],
      ["setTierPrice", { tierKey: "tier_1", countryCode: "IQ", currency: "IQD", amount: 1 }],
      ["setPaymentRouting", { countryCode: "IQ", kind: "tier_payment", gateway: "manual" }],
      [
        "recordTierPayment",
        { idempotencyKey: nextIdempotencyKey(), facilityId: fx.facilityId, tierKey: "tier_1" },
      ],
      [
        "recordSubscriptionPayment",
        {
          idempotencyKey: nextIdempotencyKey(),
          doctorProfileId: fx.doctorProfileId,
          amount: 1,
          currency: "IQD",
        },
      ],
      ["expireSubscription", { doctorProfileId: fx.doctorProfileId, toGrace: false }],
    ];
  }

  it("denies every admin command to non-admin roles and anonymous callers", async () => {
    for (const [procedure, input] of adminCommands()) {
      for (const roles of ["doctor", "secretary", "patient"]) {
        const res = await trpc(app, `billing.${procedure}`, "mutation", input, {
          roles,
          user: "intruder",
        });
        expect(res.statusCode, `${procedure} as ${roles}`).toBe(403);
        expect(appCode(res), `${procedure} as ${roles}`).toBe("FORBIDDEN");
      }
      const anonymous = await trpc(app, `billing.${procedure}`, "mutation", input);
      expect(anonymous.statusCode, `${procedure} anonymous`).toBe(401);
      expect(appCode(anonymous), `${procedure} anonymous`).toBe("UNAUTHORIZED");
    }
  });

  it("denies the admin tier-state view and doctor subscription view across roles", async () => {
    const state = await trpc(
      app,
      "billing.facilityTierState",
      "query",
      { facilityId: fx.facilityId },
      { roles: "doctor", user: "intruder" },
    );
    expect(state.statusCode).toBe(403);

    const mine = await trpc(app, "billing.mySubscription", "query", undefined, {
      roles: "patient",
      user: "intruder",
    });
    expect(mine.statusCode).toBe(403);
  });

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
