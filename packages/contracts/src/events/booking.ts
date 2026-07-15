/**
 * Booking module event contracts (MM-PLAN-001 §5 Phase 4). Versioned and
 * additive-only per §3.3 — breaking change = new version.
 *
 * Payloads carry the denormalized appointment snapshot downstream modules
 * need (clinical encounter creation on completed, communication dispatch,
 * queue read models), so subscribers never join booking tables (§3.1).
 */
import { z } from "zod";
import { defineEvent } from "./index.js";

export const APPOINTMENT_STATUSES = [
  "booked",
  "confirmed",
  "checked_in",
  "in_progress",
  "completed",
  "cancelled",
  "no_show",
  "delayed",
] as const;

export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const BOOKING_CHANNELS = ["guest_web", "patient_account", "secretary_walk_in"] as const;

export type BookingChannel = (typeof BOOKING_CHANNELS)[number];

const appointmentSnapshotSchema = z.object({
  appointmentId: z.string(),
  doctorLocationId: z.string(),
  /** Directory doctor profile the location row belongs to. */
  doctorProfileId: z.string(),
  patientProfileId: z.string(),
  /** UTC instants as ISO strings. */
  startsAt: z.string(),
  endsAt: z.string(),
  status: z.enum(APPOINTMENT_STATUSES),
  bookedVia: z.enum(BOOKING_CHANNELS),
});

export const bookingBookedV1 = defineEvent("booking", "booked", 1, appointmentSnapshotSchema);

export const bookingConfirmedV1 = defineEvent("booking", "confirmed", 1, appointmentSnapshotSchema);

export const bookingRescheduledV1 = defineEvent(
  "booking",
  "rescheduled",
  1,
  appointmentSnapshotSchema.extend({
    previousStartsAt: z.string(),
    previousEndsAt: z.string(),
  }),
);

export const bookingCancelledV1 = defineEvent(
  "booking",
  "cancelled",
  1,
  appointmentSnapshotSchema.extend({
    reason: z.string().nullable(),
  }),
);

export const bookingCompletedV1 = defineEvent("booking", "completed", 1, appointmentSnapshotSchema);

export const bookingNoShowV1 = defineEvent("booking", "no_show", 1, appointmentSnapshotSchema);

/**
 * Phase 9c (MM-DES-002 §5): emitted when a late patient is delayed —
 * pushed down the queue by state, never by moving instants. Payload is the
 * standard post-transition snapshot (status "delayed"). No subscriber this
 * phase; the planned consumer is a future notification system.
 */
export const bookingDelayedV1 = defineEvent("booking", "delayed", 1, appointmentSnapshotSchema);

/** All booking event contracts, for registry composition in the API. */
export const BOOKING_EVENTS = [
  bookingBookedV1,
  bookingConfirmedV1,
  bookingRescheduledV1,
  bookingCancelledV1,
  bookingCompletedV1,
  bookingNoShowV1,
  bookingDelayedV1,
] as const;
