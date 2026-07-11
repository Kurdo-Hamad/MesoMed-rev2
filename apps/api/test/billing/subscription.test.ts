import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import {
  browseDoctorsOutputSchema,
  mySubscriptionOutputSchema,
  recordSubscriptionPaymentResultSchema,
} from "@mesomed/contracts";
import { computeNewExpiry } from "@mesomed/domain/billing";
import { doctorProfiles, domainEvents, eq, subscriptionPayments } from "@mesomed/db";
import {
  ADMIN,
  buildBillingTestServer,
  nextIdempotencyKey,
  result,
  seedBillingFixture,
  trpc,
  waitFor,
  type BillingFixture,
} from "./helpers.js";

/**
 * Phase 6 gate (MM-PLAN-001 §5): subscription events flip doctor public
 * visibility THROUGH THE OUTBOX DISPATCHER with no changes to directory
 * module code — this suite drives billing procedures and observes the flip
 * exclusively via directory reads (`directory.browseDoctors` and the
 * denormalized column), never by touching directory internals.
 */
describe("doctor subscription lifecycle drives directory visibility", () => {
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

  async function doctorVisible(doctorProfileId: string): Promise<boolean> {
    const [row] = await app.kernel.db
      .select({ publiclyVisible: doctorProfiles.publiclyVisible })
      .from(doctorProfiles)
      .where(eq(doctorProfiles.id, doctorProfileId));
    return row?.publiclyVisible ?? false;
  }

  async function browsedSlugs(): Promise<string[]> {
    const res = await trpc(
      app,
      "directory.browseDoctors",
      "query",
      { limit: 50 },
      { country: "IQ" },
    );
    expect(res.statusCode).toBe(200);
    return browseDoctorsOutputSchema.parse(result(res)).items.map((item) => item.slug);
  }

  function eventCount(name: string): Promise<number> {
    return app.kernel.db
      .select()
      .from(domainEvents)
      .where(eq(domainEvents.name, name))
      .then((rows) => rows.length);
  }

  it("gates an account-backed doctor on subscription; curated listings stay visible", async () => {
    // Approved identity, active listing — but never billed: not public.
    expect(await doctorVisible(fx.doctorProfileId)).toBe(false);
    // No identity account to bill: visible on approved + active alone.
    expect(await doctorVisible(fx.curatedDoctorProfileId)).toBe(true);

    const slugs = await browsedSlugs();
    expect(slugs).toContain(fx.curatedDoctorSlug);
    expect(slugs).not.toContain(fx.doctorSlug);
  });

  it("activates via manual payment and flips visibility through the dispatcher", async () => {
    const res = await trpc(
      app,
      "billing.recordSubscriptionPayment",
      "mutation",
      {
        idempotencyKey: nextIdempotencyKey("sub"),
        doctorProfileId: fx.doctorProfileId,
        amount: 50_000,
        currency: "IQD",
      },
      { ...ADMIN, user: "admin-under-test" },
    );
    expect(res.statusCode).toBe(200);
    const body = recordSubscriptionPaymentResultSchema.parse(result(res));
    expect(body.applied).toBe(true);
    expect(body.status).toBe("active");
    expect(body.paidUntil).not.toBeNull();

    // The flip arrives via billing.subscription_activated.v1 → directory
    // subscriber → recompute — no directory command in sight.
    await waitFor(async () => (await doctorVisible(fx.doctorProfileId)) || undefined);
    expect(await browsedSlugs()).toContain(fx.doctorSlug);
  });

  it("is a no-op on idempotency-key replay: no extension, no second event", async () => {
    const key = nextIdempotencyKey("sub-replay");
    const input = {
      idempotencyKey: key,
      doctorProfileId: fx.doctorProfileId,
      amount: 50_000,
      currency: "IQD",
    };
    const session = { ...ADMIN, user: "admin-under-test" };

    const first = recordSubscriptionPaymentResultSchema.parse(
      result(await trpc(app, "billing.recordSubscriptionPayment", "mutation", input, session)),
    );
    expect(first.applied).toBe(true);
    const activatedAfterFirst = await eventCount("billing.subscription_activated.v1");

    const replay = recordSubscriptionPaymentResultSchema.parse(
      result(await trpc(app, "billing.recordSubscriptionPayment", "mutation", input, session)),
    );
    expect(replay.applied).toBe(false);
    expect(replay.paidUntil).toBe(first.paidUntil);

    const payments = await app.kernel.db
      .select()
      .from(subscriptionPayments)
      .where(eq(subscriptionPayments.idempotencyKey, key));
    expect(payments).toHaveLength(1);
    expect(await eventCount("billing.subscription_activated.v1")).toBe(activatedAfterFirst);
  });

  it("renews from the current paid-until, not from now", async () => {
    const before = mySubscriptionOutputSchema.parse(
      result(
        await trpc(app, "billing.mySubscription", "query", undefined, {
          roles: "doctor",
          user: fx.doctorUserId,
        }),
      ),
    ).subscription;
    expect(before).not.toBeNull();

    const renewal = recordSubscriptionPaymentResultSchema.parse(
      result(
        await trpc(
          app,
          "billing.recordSubscriptionPayment",
          "mutation",
          {
            idempotencyKey: nextIdempotencyKey("sub-renew"),
            doctorProfileId: fx.doctorProfileId,
            amount: 50_000,
            currency: "IQD",
          },
          { ...ADMIN, user: "admin-under-test" },
        ),
      ),
    );
    expect(renewal.applied).toBe(true);
    // Renewal extends the FUTURE expiry by one calendar month — the ported
    // computeNewExpiry semantics, not "+1 month from now".
    const expected = computeNewExpiry(new Date(before!.paidUntil!), 1);
    expect(new Date(renewal.paidUntil!).getTime()).toBe(expected.getTime());
  });

  it("grace period keeps the doctor visible and emits no expiry event", async () => {
    const expired = await eventCount("billing.subscription_expired.v1");
    const res = await trpc(
      app,
      "billing.expireSubscription",
      "mutation",
      { doctorProfileId: fx.doctorProfileId, toGrace: true },
      { ...ADMIN, user: "admin-under-test" },
    );
    expect(res.statusCode).toBe(200);
    expect(result<{ status: string }>(res).status).toBe("grace_period");

    expect(await eventCount("billing.subscription_expired.v1")).toBe(expired);
    expect(await doctorVisible(fx.doctorProfileId)).toBe(true);
    expect(await browsedSlugs()).toContain(fx.doctorSlug);
  });

  it("deactivation emits billing.subscription_expired.v1 and hides the doctor", async () => {
    const res = await trpc(
      app,
      "billing.expireSubscription",
      "mutation",
      { doctorProfileId: fx.doctorProfileId, toGrace: false },
      { ...ADMIN, user: "admin-under-test" },
    );
    expect(res.statusCode).toBe(200);
    expect(result<{ status: string }>(res).status).toBe("inactive");

    await waitFor(async () => !(await doctorVisible(fx.doctorProfileId)) || undefined);
    expect(await browsedSlugs()).not.toContain(fx.doctorSlug);
    // The curated listing is untouched by billing state.
    expect(await doctorVisible(fx.curatedDoctorProfileId)).toBe(true);
  });

  it("re-activates on a fresh payment — the flip works in both directions", async () => {
    const res = await trpc(
      app,
      "billing.recordSubscriptionPayment",
      "mutation",
      {
        idempotencyKey: nextIdempotencyKey("sub-reactivate"),
        doctorProfileId: fx.doctorProfileId,
        amount: 50_000,
        currency: "IQD",
      },
      { ...ADMIN, user: "admin-under-test" },
    );
    expect(res.statusCode).toBe(200);
    await waitFor(async () => (await doctorVisible(fx.doctorProfileId)) || undefined);
    expect(await browsedSlugs()).toContain(fx.doctorSlug);
  });

  it("mySubscription binds to the session's own doctor profile (layer b)", async () => {
    const own = mySubscriptionOutputSchema.parse(
      result(
        await trpc(app, "billing.mySubscription", "query", undefined, {
          roles: "doctor",
          user: fx.doctorUserId,
        }),
      ),
    );
    expect(own.subscription?.doctorProfileId).toBe(fx.doctorProfileId);
    expect(own.subscription?.status).toBe("active");

    // A doctor session with no directory profile sees nothing — not
    // somebody else's subscription.
    const stranger = mySubscriptionOutputSchema.parse(
      result(
        await trpc(app, "billing.mySubscription", "query", undefined, {
          roles: "doctor",
          user: "doctor-with-no-profile",
        }),
      ),
    );
    expect(stranger.subscription).toBeNull();
  });
});
