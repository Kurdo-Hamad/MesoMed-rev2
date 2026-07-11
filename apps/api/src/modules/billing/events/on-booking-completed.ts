/**
 * Billing subscriber for booking.completed.v1 (MM-PLAN-001 §5 Phase 6b):
 * per-booking charges are calculated HERE and only here — accrued as
 * provider debt on the completed booking, never charged at booking time
 * (MM-DEC friction-free booking is not amended this phase).
 *
 * The charge derives from the provider's selected model with the resolved
 * rate snapshotted onto the row; per-booking charges accrue from day one,
 * INCLUDING during trial (trial waives the subscription fee only). Runs on
 * the handler's idempotency-claimed transaction; the ledger's unique
 * constraints (idempotency key; booking/reason tuple) make redelivery a
 * provable no-op — exactly one charge row per completed booking.
 *
 * A provider with no billing config accrues nothing (transitional state —
 * admin-curated listings have nobody to bill; see ADR-0009 on the
 * ADR-0008 visibility-exemption supersession). A provider WITH a model but
 * a missing/inactive rate row fails loudly (typed RATE_NOT_CONFIGURED →
 * retry → dead-letter): misconfiguration must surface, never under-bill
 * silently.
 */
import type { EventEnvelope, bookingCompletedV1 } from "@mesomed/contracts";
import { bookingChargeFor } from "@mesomed/domain/billing";
import { eq, providerBillingConfig } from "@mesomed/db";
import type { EventHandlerFn } from "../../../kernel/events.js";
import type { OutboxEmitter } from "../../../kernel/outbox.js";
import { getProviderRefForDoctorProfile } from "../../directory/queries/provider-refs.js";
import { requireActiveRate } from "../commands/rate-config.js";
import { recordCharge } from "../commands/charges.js";

export const ON_BOOKING_COMPLETED_HANDLER = "billing.record-booking-charge";

export function createOnBookingCompleted(deps: { outbox: OutboxEmitter }): EventHandlerFn {
  return async (envelope, tx) => {
    const { payload } = envelope as EventEnvelope<typeof bookingCompletedV1>;

    const ref = await getProviderRefForDoctorProfile(tx, payload.doctorProfileId);
    if (!ref) return; // Listing no longer exists — nothing to bill.

    const [cfg] = await tx
      .select()
      .from(providerBillingConfig)
      .where(eq(providerBillingConfig.providerId, ref.providerId))
      .limit(1);
    if (!cfg) return; // No revenue model selected — nothing accrues.

    const rateKind = cfg.model === "commission" ? "commission_pct" : "per_booking_fee";
    const rate = await requireActiveRate(tx, cfg.category, cfg.model, rateKind);

    const charge = bookingChargeFor(
      cfg.model === "commission"
        ? {
            model: "commission",
            commissionBasisPoints: rate.value,
            bookingValueMinor: cfg.bookingValueMinor ?? undefined,
          }
        : { model: "flat_monthly", perBookingFeeMinor: rate.value },
    );
    if (charge.amountMinor === 0) return; // A configured-free booking fee accrues nothing.

    await recordCharge(tx, deps.outbox, {
      payer: "provider",
      reason: charge.reason,
      providerId: ref.providerId,
      bookingId: payload.appointmentId,
      subscriptionId: cfg.id,
      amountMinor: charge.amountMinor,
      currency: rate.currency,
      rateKind,
      rateValue: rate.value,
      rateBaseMinor: cfg.model === "commission" ? cfg.bookingValueMinor : null,
      idempotencyKey: `booking-charge:${payload.appointmentId}:${charge.reason}`,
    });
  };
}
