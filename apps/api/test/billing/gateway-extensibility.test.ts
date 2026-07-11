import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import {
  ADMIN,
  appCode,
  buildBillingTestServer,
  completeBooking,
  createSpyGateway,
  result,
  seedRevenueFixture,
  trpc,
  waitForBookingCharge,
  type RevenueFixture,
  type SpyGateway,
} from "./helpers.js";

/**
 * Phase 6b gate — gateway-extensibility proof: adding a gateway requires
 * ONLY an adapter in packages/platform plus config rows. A brand-new id
 * ("fakepay") is registered purely via config, becomes routable, fails
 * closed while no adapter is wired, and works the moment one is injected
 * through the composition-root seam. `stripe` ships in the same state:
 * routable id, fail-closed, no SDK, no live integration.
 */
describe("config-driven gateway registry", () => {
  let tdb: TestDatabase;
  let appWithoutAdapter: FastifyInstance;
  let fx: RevenueFixture;

  beforeAll(async () => {
    tdb = await createTestDatabase();
    appWithoutAdapter = await buildBillingTestServer(tdb.connectionString);
    await appWithoutAdapter.ready();
    fx = await seedRevenueFixture(appWithoutAdapter);
  }, 120_000);

  afterAll(async () => {
    await appWithoutAdapter.close();
    await tdb.close();
  });

  it("an unknown id is rejected until registered — then routable via config alone", async () => {
    // Not yet registered: routing to it is a validation failure.
    const before = await trpc(
      appWithoutAdapter,
      "billing.setPaymentRouting",
      "mutation",
      { countryCode: "IQ", kind: "provider_charge", gateway: "fakepay" },
      ADMIN,
    );
    expect(before.statusCode).toBe(400);

    // Registration is a config row (admin command writes it), no deploy.
    const register = await trpc(
      appWithoutAdapter,
      "billing.registerPaymentGateway",
      "mutation",
      { gateway: "fakepay" },
      ADMIN,
    );
    expect(register.statusCode).toBe(200);
    expect(result<{ gateways: string[] }>(register).gateways).toContain("fakepay");

    const after = await trpc(
      appWithoutAdapter,
      "billing.setPaymentRouting",
      "mutation",
      { countryCode: "IQ", kind: "provider_charge", gateway: "fakepay" },
      ADMIN,
    );
    expect(after.statusCode).toBe(200);
  });

  it("fails closed while the adapter is missing: typed error, nothing settles", async () => {
    const appointmentId = await completeBooking(appWithoutAdapter, fx.flatClinic);
    const charge = await waitForBookingCharge(appWithoutAdapter, appointmentId);

    const res = await trpc(
      appWithoutAdapter,
      "billing.settleCharge",
      "mutation",
      { chargeId: charge.id },
      { ...ADMIN, country: "IQ" },
    );
    expect(res.statusCode).toBe(412);
    expect(appCode(res)).toBe("PAYMENT_GATEWAY_NOT_CONFIGURED");
  });

  it("the SAME config works the moment a real adapter is wired — zero further config", async () => {
    const spy: SpyGateway = createSpyGateway("fakepay");
    const appWithAdapter = await buildBillingTestServer(tdb.connectionString, {}, { fakepay: spy });
    await appWithAdapter.ready();
    try {
      const appointmentId = await completeBooking(appWithAdapter, fx.flatClinic);
      const charge = await waitForBookingCharge(appWithAdapter, appointmentId);

      const res = await trpc(
        appWithAdapter,
        "billing.settleCharge",
        "mutation",
        { chargeId: charge.id },
        { ...ADMIN, country: "IQ" },
      );
      expect(res.statusCode).toBe(200);
      expect(result<{ gatewayId: string }>(res).gatewayId).toBe("fakepay");
      expect(spy.initiations).toHaveLength(1);
    } finally {
      await appWithAdapter.close();
    }
  });

  it("stripe is a routable launch id, fail-closed like fib/zaincash", async () => {
    for (const gateway of ["stripe", "fib", "zaincash"]) {
      const route = await trpc(
        appWithoutAdapter,
        "billing.setPaymentRouting",
        "mutation",
        { countryCode: "JO", kind: "tier_payment", gateway },
        ADMIN,
      );
      expect(route.statusCode, gateway).toBe(200);
    }

    // Route JO provider-charge settlements to stripe (id known, adapter
    // absent) and prove resolution fails typed — interface-ready only.
    const route = await trpc(
      appWithoutAdapter,
      "billing.setPaymentRouting",
      "mutation",
      { countryCode: "JO", kind: "provider_charge", gateway: "stripe" },
      ADMIN,
    );
    expect(route.statusCode).toBe(200);

    const appointmentId = await completeBooking(appWithoutAdapter, fx.flatClinic);
    const charge = await waitForBookingCharge(appWithoutAdapter, appointmentId);
    const res = await trpc(
      appWithoutAdapter,
      "billing.settleCharge",
      "mutation",
      { chargeId: charge.id },
      { ...ADMIN, country: "JO" },
    );
    expect(res.statusCode).toBe(412);
    expect(appCode(res)).toBe("PAYMENT_GATEWAY_NOT_CONFIGURED");
  });
});
