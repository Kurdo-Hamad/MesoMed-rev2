import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import { accrueSubscriptionFeeResultSchema } from "@mesomed/contracts";
import { addUtcMonths } from "@mesomed/domain/billing";
import { billingCharges, eq, providerBillingConfig } from "@mesomed/db";
import {
  ADMIN,
  appCode,
  buildBillingTestServer,
  completeBooking,
  result,
  seedRevenueFixture,
  trpc,
  waitForBookingCharge,
  RATE_MONTHLY_FEE_MINOR,
  type RevenueFixture,
} from "./helpers.js";

/**
 * Phase 6b gate — trial proof: the free trial waives the SUBSCRIPTION FEE
 * only; per-booking charges accrue from day one, including during trial.
 * Both trial knobs are config-driven (global default months; per-provider
 * trial_ends_at override) and both expiry paths resume accrual.
 */
describe("subscription-fee accrual and the trial window", () => {
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

  async function accrue(providerId: string) {
    const res = await trpc(app, "billing.accrueSubscriptionFee", "mutation", { providerId }, ADMIN);
    expect(res.statusCode).toBe(200);
    return accrueSubscriptionFeeResultSchema.parse(result(res));
  }

  async function subscriptionFeeCharges(providerId: string) {
    const rows = await tdb.db
      .select()
      .from(billingCharges)
      .where(eq(billingCharges.providerId, providerId));
    return rows.filter((row) => row.reason === "subscription_fee");
  }

  it("trial proof (global default): per-booking charges accrue, the monthly fee is waived", async () => {
    // A 6-month global default — the provider's config was created moments
    // ago, so it is inside the window.
    const res = await trpc(app, "billing.setTrialDefault", "mutation", { months: 6 }, ADMIN);
    expect(res.statusCode).toBe(200);
    app.kernel.config.invalidate();

    // Per-booking charge accrues during trial…
    const appointmentId = await completeBooking(app, fx.flatClinic);
    const bookingCharge = await waitForBookingCharge(app, appointmentId);
    expect(bookingCharge.reason).toBe("per_booking_fee");

    // …but the subscription fee is waived.
    const outcome = await accrue(fx.flatProviderId);
    expect(outcome.outcome).toBe("trial_waived");
    expect(outcome.chargeId).toBeNull();
    expect(await subscriptionFeeCharges(fx.flatProviderId)).toHaveLength(0);
  });

  let firstPeriod: { periodStart: string; periodEnd: string };

  it("global-default expiry resumes accrual, with periods anchored on the trial end", async () => {
    // Backdate the config creation ~7.5 months: the 6-month default window
    // lapsed ~1.5 months ago, so exactly two monthly periods are due.
    // (Scaffolding: the anchor is created_at.)
    const anchor = new Date(addUtcMonths(new Date(), -7).getTime() - 15 * 86_400_000);
    await tdb.db
      .update(providerBillingConfig)
      .set({ createdAt: anchor })
      .where(eq(providerBillingConfig.providerId, fx.flatProviderId));
    const trialEnd = addUtcMonths(anchor, 6);

    const first = await accrue(fx.flatProviderId);
    expect(first.outcome).toBe("accrued");
    expect(first.chargeId).not.toBeNull();
    // Fee accrual starts where the trial ended, not at config creation.
    expect(first.periodStart).toBe(trialEnd.toISOString());
    expect(first.periodEnd).toBe(addUtcMonths(trialEnd, 1).toISOString());
    firstPeriod = { periodStart: first.periodStart!, periodEnd: first.periodEnd! };

    const charges = await subscriptionFeeCharges(fx.flatProviderId);
    expect(charges).toHaveLength(1);
    expect(charges[0]!.amountMinor).toBe(RATE_MONTHLY_FEE_MINOR);
    expect(charges[0]!.rateKind).toBe("monthly_fee");
    expect(charges[0]!.periodStart!.toISOString()).toBe(first.periodStart);

    // The next call accrues the NEXT month — consecutive, no gap, no overlap.
    const second = await accrue(fx.flatProviderId);
    expect(second.outcome).toBe("accrued");
    expect(second.periodStart).toBe(first.periodEnd);

    // Fully caught up (the second period ends ~15 days out): nothing due.
    const third = await accrue(fx.flatProviderId);
    expect(third.outcome).toBe("not_due");
    expect(await subscriptionFeeCharges(fx.flatProviderId)).toHaveLength(2);
  });

  it("replaying an accrued period is a no-op at the ledger's unique constraints", async () => {
    const [cfg] = await tdb.db
      .select()
      .from(providerBillingConfig)
      .where(eq(providerBillingConfig.providerId, fx.flatProviderId));

    // A duplicate insert of an already-accrued period — the deterministic
    // idempotency key AND the (provider, period-start) partial unique
    // index each make it a silent no-op, exactly like Phase 6 payments.
    const duplicate = await tdb.db
      .insert(billingCharges)
      .values({
        payer: "provider",
        reason: "subscription_fee",
        providerId: fx.flatProviderId,
        subscriptionId: cfg!.id,
        amountMinor: RATE_MONTHLY_FEE_MINOR,
        currency: "IQD",
        periodStart: new Date(firstPeriod.periodStart),
        periodEnd: new Date(firstPeriod.periodEnd),
        idempotencyKey: `subfee:${fx.flatProviderId}:${firstPeriod.periodStart}`,
      })
      .onConflictDoNothing()
      .returning({ id: billingCharges.id });
    expect(duplicate).toHaveLength(0);

    // A fresh key alone doesn't help — the period tuple still conflicts.
    const freshKey = await tdb.db
      .insert(billingCharges)
      .values({
        payer: "provider",
        reason: "subscription_fee",
        providerId: fx.flatProviderId,
        subscriptionId: cfg!.id,
        amountMinor: RATE_MONTHLY_FEE_MINOR,
        currency: "IQD",
        periodStart: new Date(firstPeriod.periodStart),
        periodEnd: new Date(firstPeriod.periodEnd),
        idempotencyKey: `subfee-divergent-${Date.now()}`,
      })
      .onConflictDoNothing()
      .returning({ id: billingCharges.id });
    expect(freshKey).toHaveLength(0);

    expect(await subscriptionFeeCharges(fx.flatProviderId)).toHaveLength(2);
  });

  it("per-provider trial override wins over the global default (both directions)", async () => {
    // The commission provider pays no monthly fee at all…
    const commissionOutcome = await accrue(fx.commissionProviderId);
    expect(commissionOutcome.outcome).toBe("not_applicable");

    // …so exercise the override on the flat provider: an override in the
    // FUTURE re-enters trial even though the global window has lapsed.
    const future = addUtcMonths(new Date(), 2);
    const set = await trpc(
      app,
      "billing.setProviderBillingModel",
      "mutation",
      { providerId: fx.flatProviderId, model: "flat_monthly", trialEndsAt: future.toISOString() },
      ADMIN,
    );
    expect(set.statusCode).toBe(200);
    expect((await accrue(fx.flatProviderId)).outcome).toBe("trial_waived");

    // Override expiry (in the past) resumes accrual immediately.
    const past = addUtcMonths(new Date(), -1);
    await trpc(
      app,
      "billing.setProviderBillingModel",
      "mutation",
      { providerId: fx.flatProviderId, model: "flat_monthly", trialEndsAt: past.toISOString() },
      ADMIN,
    );
    const resumed = await accrue(fx.flatProviderId);
    expect(["accrued", "not_due"]).toContain(resumed.outcome);
  });

  it("accrual without a billing model is a typed precondition failure", async () => {
    const res = await trpc(
      app,
      "billing.accrueSubscriptionFee",
      "mutation",
      { providerId: "00000000-0000-4000-8000-000000000000" },
      ADMIN,
    );
    expect(res.statusCode).toBe(412);
    expect(appCode(res)).toBe("BILLING_MODEL_NOT_CONFIGURED");
  });
});
