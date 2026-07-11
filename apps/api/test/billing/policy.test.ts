import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import { myCancellationPolicyOutputSchema } from "@mesomed/contracts";
import { and, billingCharges, billingPolicyEvaluations, domainEvents, eq } from "@mesomed/db";
import {
  ADMIN,
  buildBillingTestServer,
  cancelBooking,
  createSpyGateway,
  noShowBooking,
  result,
  seedRevenueFixture,
  trpc,
  waitForPolicyEvaluation,
  type RevenueFixture,
  type SpyGateway,
} from "./helpers.js";

/**
 * Phase 6b gate — dormancy proof. The provider cancellation/no-show policy
 * is fully stored and settable NOW; every cancelled/no-show booking gets a
 * policy-evaluation record. While billing.patient_collection_enabled is
 * false (the launch default), a fee-bearing evaluation produces ZERO
 * settled patient charges and ZERO gateway calls; flipping the flag
 * in-test activates the already-wired path against a fake gateway with no
 * code change.
 */
describe("cancellation/no-show policy: dormant collection behind the global flag", () => {
  let tdb: TestDatabase;
  let app: FastifyInstance;
  let fx: RevenueFixture;
  let spy: SpyGateway;

  beforeAll(async () => {
    tdb = await createTestDatabase();
    spy = createSpyGateway("spypay");
    app = await buildBillingTestServer(tdb.connectionString, {}, { spypay: spy });
    await app.ready();
    fx = await seedRevenueFixture(app);

    // Fee-bearing policy for the commission clinic's provider: the free
    // window (720h) far exceeds the ~168h booking lead time, so every
    // cancellation in this suite is inside the chargeable window.
    const res = await trpc(
      app,
      "billing.setCancellationPolicy",
      "mutation",
      {
        providerId: fx.commissionProviderId,
        freeCancellationWindowHours: 720,
        cancellationFeeMinor: 5_000_000,
        noShowFeeMinor: 10_000_000,
        currency: "IQD",
        enabled: true,
      },
      ADMIN,
    );
    if (res.statusCode !== 200) throw new Error(`policy fixture failed: ${res.body}`);

    // Patient charges route to the spy gateway — reachable ONLY once the
    // global flag flips.
    const routing = await trpc(
      app,
      "billing.setPaymentRouting",
      "mutation",
      { countryCode: "IQ", kind: "patient_charge", gateway: "spypay" },
      ADMIN,
    );
    if (routing.statusCode !== 200) throw new Error(`routing fixture failed: ${routing.body}`);
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await tdb.close();
  });

  async function patientCharges() {
    const rows = await tdb.db.select().from(billingCharges);
    return rows.filter((row) => row.payer === "patient");
  }

  it("providers manage their own policy; strangers are denied (layer b)", async () => {
    // The owning doctor reads the policy the admin set.
    const own = await trpc(app, "billing.myCancellationPolicy", "query", undefined, {
      roles: "doctor",
      user: fx.commissionClinic.doctorUserId,
    });
    expect(own.statusCode).toBe(200);
    const policy = myCancellationPolicyOutputSchema.parse(result(own)).policy;
    expect(policy?.cancellationFeeMinor).toBe(5_000_000);
    expect(policy?.enabled).toBe(true);

    // The owning doctor updates its own policy without naming a provider.
    const update = await trpc(
      app,
      "billing.setCancellationPolicy",
      "mutation",
      {
        freeCancellationWindowHours: 720,
        cancellationFeeMinor: 5_000_000,
        noShowFeeMinor: 10_000_000,
        currency: "IQD",
        enabled: true,
      },
      { roles: "doctor", user: fx.commissionClinic.doctorUserId },
    );
    expect(update.statusCode).toBe(200);

    // A doctor may not touch ANOTHER provider's policy.
    const foreign = await trpc(
      app,
      "billing.setCancellationPolicy",
      "mutation",
      {
        providerId: fx.flatProviderId,
        freeCancellationWindowHours: 1,
        cancellationFeeMinor: 0,
        noShowFeeMinor: 0,
        currency: "IQD",
        enabled: false,
      },
      { roles: "doctor", user: fx.commissionClinic.doctorUserId },
    );
    expect(foreign.statusCode).toBe(403);

    // Patients/anonymous callers have no policy surface at all.
    const patient = await trpc(app, "billing.myCancellationPolicy", "query", undefined, {
      roles: "patient",
      user: "patient-x",
    });
    expect(patient.statusCode).toBe(403);
  });

  it("DORMANT: fee-bearing cancellation → evaluation record, zero patient charges, zero gateway calls", async () => {
    const appointmentId = await cancelBooking(app, fx.commissionClinic);
    const evaluation = await waitForPolicyEvaluation(app, appointmentId);

    expect(evaluation.trigger).toBe("cancellation");
    expect(evaluation.outcome).toBe("fee_applicable");
    expect(evaluation.feeMinor).toBe(5_000_000);
    expect(evaluation.currency).toBe("IQD");
    expect(evaluation.collectionEnabled).toBe(false);
    expect(evaluation.chargeId).toBeNull();

    expect(await patientCharges()).toHaveLength(0);
    expect(spy.initiations).toHaveLength(0);
  });

  it("DORMANT: no-show → same shape, still nothing collectable", async () => {
    const appointmentId = await noShowBooking(app, fx.commissionClinic);
    const evaluation = await waitForPolicyEvaluation(app, appointmentId);

    expect(evaluation.trigger).toBe("no_show");
    expect(evaluation.outcome).toBe("fee_applicable");
    expect(evaluation.feeMinor).toBe(10_000_000);
    expect(evaluation.chargeId).toBeNull();

    expect(await patientCharges()).toHaveLength(0);
    expect(spy.initiations).toHaveLength(0);
  });

  it("a provider with no policy row evaluates as no_policy", async () => {
    const appointmentId = await cancelBooking(app, fx.flatClinic);
    const evaluation = await waitForPolicyEvaluation(app, appointmentId);
    expect(evaluation.outcome).toBe("no_policy");
    expect(evaluation.feeMinor).toBe(0);
    expect(await patientCharges()).toHaveLength(0);
  });

  it("ACTIVATION: flipping the config flag routes the SAME path through the fake gateway — zero code change", async () => {
    const flip = await trpc(
      app,
      "billing.setPatientCollectionEnabled",
      "mutation",
      { enabled: true },
      ADMIN,
    );
    expect(flip.statusCode).toBe(200);
    app.kernel.config.invalidate();

    const appointmentId = await cancelBooking(app, fx.commissionClinic);
    const evaluation = await waitForPolicyEvaluation(app, appointmentId);
    expect(evaluation.outcome).toBe("fee_applicable");
    expect(evaluation.collectionEnabled).toBe(true);
    expect(evaluation.chargeId).not.toBeNull();

    // The patient charge row exists, settled through the spy gateway.
    const [charge] = await tdb.db
      .select()
      .from(billingCharges)
      .where(eq(billingCharges.id, evaluation.chargeId!));
    expect(charge!.payer).toBe("patient");
    expect(charge!.reason).toBe("cancellation_fee");
    expect(charge!.amountMinor).toBe(5_000_000);
    expect(charge!.status).toBe("settled");
    expect(charge!.gatewayId).toBe("spypay");
    expect(charge!.gatewayChargeRef).toContain("spypay:");
    expect(charge!.patientProfileId).not.toBeNull();

    expect(spy.initiations).toHaveLength(1);
    expect(spy.initiations[0]).toMatchObject({
      kind: "patient_charge",
      amount: 5_000_000,
      currency: "IQD",
    });

    // Recorded AND settled events both emitted through the outbox.
    for (const name of ["billing.charge_recorded.v1", "billing.charge_settled.v1"]) {
      const events = await tdb.db
        .select()
        .from(domainEvents)
        .where(
          and(eq(domainEvents.name, name), eq(domainEvents.aggregateId, evaluation.chargeId!)),
        );
      expect(events).toHaveLength(1);
    }

    // Flip back off: the very next cancellation is dormant again.
    await trpc(app, "billing.setPatientCollectionEnabled", "mutation", { enabled: false }, ADMIN);
    app.kernel.config.invalidate();
    const dormantAgain = await cancelBooking(app, fx.commissionClinic);
    const dormantEval = await waitForPolicyEvaluation(app, dormantAgain);
    expect(dormantEval.collectionEnabled).toBe(false);
    expect(dormantEval.chargeId).toBeNull();
    expect(spy.initiations).toHaveLength(1);
  });

  it("a short free window evaluates a 7-days-out cancellation as within_free_window", async () => {
    // Shrink the window to 1 hour: cancelling ~168h before start is free.
    await trpc(
      app,
      "billing.setCancellationPolicy",
      "mutation",
      {
        providerId: fx.commissionProviderId,
        freeCancellationWindowHours: 1,
        cancellationFeeMinor: 5_000_000,
        noShowFeeMinor: 10_000_000,
        currency: "IQD",
        enabled: true,
      },
      ADMIN,
    );
    const appointmentId = await cancelBooking(app, fx.commissionClinic);
    const evaluation = await waitForPolicyEvaluation(app, appointmentId);
    expect(evaluation.outcome).toBe("within_free_window");
    expect(evaluation.feeMinor).toBe(0);
  });

  it("policy redelivery is a no-op: one evaluation row per (booking, trigger)", async () => {
    const appointmentId = await noShowBooking(app, fx.commissionClinic);
    await waitForPolicyEvaluation(app, appointmentId);

    const [event] = await tdb.db
      .select({ id: domainEvents.id })
      .from(domainEvents)
      .where(
        and(
          eq(domainEvents.name, "booking.no_show.v1"),
          eq(domainEvents.aggregateId, appointmentId),
        ),
      );
    await app.kernel.dispatcher.redeliver(event!.id);

    const rows = await tdb.db
      .select()
      .from(billingPolicyEvaluations)
      .where(eq(billingPolicyEvaluations.bookingId, appointmentId));
    expect(rows).toHaveLength(1);
  });
});
