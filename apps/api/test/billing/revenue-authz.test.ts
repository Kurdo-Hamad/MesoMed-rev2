import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import { myBillingConfigOutputSchema } from "@mesomed/contracts";
import {
  ADMIN,
  appCode,
  buildBillingTestServer,
  result,
  seedRevenueFixture,
  trpc,
  type RevenueFixture,
} from "./helpers.js";

/**
 * Phase 6b DoD (§3.12): per-command authz-denial and invariant-violation
 * coverage for the revenue-model surface. Kernel role guard (layer a) +
 * ownership binding in handlers (layer b) + Zod/DB invariants.
 */
describe("revenue-model authz and invariants", () => {
  let tdb: TestDatabase;
  let app: FastifyInstance;
  let fx: RevenueFixture;

  beforeAll(async () => {
    tdb = await createTestDatabase();
    app = await buildBillingTestServer(tdb.connectionString);
    await app.ready();
    fx = await seedRevenueFixture(app);
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await tdb.close();
  });

  it("admin-only surfaces deny doctors, patients and anonymous callers", async () => {
    const denials: Array<[string, "query" | "mutation", unknown]> = [
      [
        "billing.setBillingRate",
        "mutation",
        {
          category: "doctor",
          model: "flat_monthly",
          rateKind: "monthly_fee",
          value: 1,
          currency: "IQD",
        },
      ],
      ["billing.listBillingRates", "query", {}],
      ["billing.providerCharges", "query", { providerId: fx.flatProviderId, limit: 10 }],
      ["billing.providerBillingConfig", "query", { providerId: fx.flatProviderId }],
      ["billing.settleCharge", "mutation", { chargeId: "00000000-0000-4000-8000-000000000000" }],
      ["billing.voidCharge", "mutation", { chargeId: "00000000-0000-4000-8000-000000000000" }],
      ["billing.refundCharge", "mutation", { chargeId: "00000000-0000-4000-8000-000000000000" }],
      ["billing.accrueSubscriptionFee", "mutation", { providerId: fx.flatProviderId }],
      ["billing.setTrialDefault", "mutation", { months: 6 }],
      ["billing.setPatientCollectionEnabled", "mutation", { enabled: true }],
      ["billing.registerPaymentGateway", "mutation", { gateway: "roguepay" }],
    ];
    for (const [procedure, kind, input] of denials) {
      for (const session of [
        { roles: "doctor", user: fx.flatClinic.doctorUserId },
        { roles: "patient", user: "patient-x" },
      ]) {
        const res = await trpc(app, procedure, kind, input, session);
        expect(res.statusCode, `${procedure} as ${session.roles}`).toBe(403);
      }
      const anonymous = await trpc(app, procedure, kind, input);
      expect(anonymous.statusCode, `${procedure} anonymous`).toBe(401);
    }
  });

  it("provider-facing surfaces deny patients and anonymous callers", async () => {
    for (const [procedure, kind, input] of [
      ["billing.myBillingConfig", "query", undefined],
      ["billing.myCharges", "query", { limit: 10 }],
      ["billing.myCancellationPolicy", "query", undefined],
    ] as const) {
      const patient = await trpc(app, procedure, kind, input, {
        roles: "patient",
        user: "patient-x",
      });
      expect(patient.statusCode, procedure).toBe(403);
      const anonymous = await trpc(app, procedure, kind, input);
      expect(anonymous.statusCode, procedure).toBe(401);
    }
  });

  it("a provider may select its OWN model but never another's, and never a trial override", async () => {
    const session = { roles: "doctor", user: fx.flatClinic.doctorUserId };

    // Own selection, no providerId named — allowed.
    const own = await trpc(
      app,
      "billing.setProviderBillingModel",
      "mutation",
      { model: "flat_monthly" },
      session,
    );
    expect(own.statusCode).toBe(200);

    // Naming another provider — denied.
    const foreign = await trpc(
      app,
      "billing.setProviderBillingModel",
      "mutation",
      { providerId: fx.commissionProviderId, model: "flat_monthly" },
      session,
    );
    expect(foreign.statusCode).toBe(403);

    // Setting one's own trial override — denied (admin knob).
    const trial = await trpc(
      app,
      "billing.setProviderBillingModel",
      "mutation",
      { model: "flat_monthly", trialEndsAt: "2030-01-01T00:00:00.000Z" },
      session,
    );
    expect(trial.statusCode).toBe(403);

    // A doctor session with no provider profile cannot select anything.
    const stranger = await trpc(
      app,
      "billing.setProviderBillingModel",
      "mutation",
      { model: "flat_monthly" },
      { roles: "doctor", user: "doctor-with-no-provider" },
    );
    expect(stranger.statusCode).toBe(403);

    // Ownership binding on the read side.
    const config = await trpc(app, "billing.myBillingConfig", "query", undefined, session);
    const body = myBillingConfigOutputSchema.parse(result(config));
    expect(body.config?.providerId).toBe(fx.flatProviderId);
    expect(body.config?.category).toBe("doctor");
  });

  it("invariants: illegal rate combos, out-of-range percentages, commission without a base", async () => {
    // commission × monthly_fee is not a legal combination.
    const combo = await trpc(
      app,
      "billing.setBillingRate",
      "mutation",
      {
        category: "doctor",
        model: "commission",
        rateKind: "monthly_fee",
        value: 1,
        currency: "IQD",
      },
      ADMIN,
    );
    expect(combo.statusCode).toBe(400);

    // Commission beyond 100%.
    const pct = await trpc(
      app,
      "billing.setBillingRate",
      "mutation",
      {
        category: "doctor",
        model: "commission",
        rateKind: "commission_pct",
        value: 10_001,
        currency: "IQD",
      },
      ADMIN,
    );
    expect(pct.statusCode).toBe(400);

    // Floats are rejected anywhere money is represented.
    const float = await trpc(
      app,
      "billing.setBillingRate",
      "mutation",
      {
        category: "doctor",
        model: "flat_monthly",
        rateKind: "monthly_fee",
        value: 100.5,
        currency: "IQD",
      },
      ADMIN,
    );
    expect(float.statusCode).toBe(400);

    // Commission model without a declared booking value.
    const base = await trpc(
      app,
      "billing.setProviderBillingModel",
      "mutation",
      { providerId: fx.flatProviderId, model: "commission" },
      ADMIN,
    );
    expect(base.statusCode).toBe(400);

    // Unknown provider fails typed.
    const unknown = await trpc(
      app,
      "billing.setProviderBillingModel",
      "mutation",
      { providerId: "00000000-0000-4000-8000-000000000000", model: "flat_monthly" },
      ADMIN,
    );
    expect(unknown.statusCode).toBe(404);
    expect(appCode(unknown)).toBe("NOT_FOUND");

    // Negative policy values are rejected.
    const policy = await trpc(
      app,
      "billing.setCancellationPolicy",
      "mutation",
      {
        providerId: fx.flatProviderId,
        freeCancellationWindowHours: -1,
        cancellationFeeMinor: 0,
        noShowFeeMinor: 0,
        currency: "IQD",
        enabled: false,
      },
      ADMIN,
    );
    expect(policy.statusCode).toBe(400);
  });
});
