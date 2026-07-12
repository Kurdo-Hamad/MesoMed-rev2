/**
 * Booking module API contracts (MM-PLAN-001 §5 Phase 4). Router I/O is
 * typed here so web/mobile share one source of truth (§3.11/§3.12).
 *
 * Instants on the wire are ISO strings (UTC); day labels and week
 * serialization for UI land with the web app (Phase 8) via the ported
 * `serializeWeekDays` domain helper.
 */
import { z } from "zod";
import {
  APPOINTMENT_STATUSES,
  BOOKING_CHANNELS,
  type AppointmentStatus,
  type BookingChannel,
} from "./events/booking.js";

export { APPOINTMENT_STATUSES, BOOKING_CHANNELS };
export type { AppointmentStatus, BookingChannel };

/** Guest booking patient details (MM-DEC rev02 §1): name + phone required. */
export const bookingPatientSchema = z.object({
  fullName: z.string().min(1).max(200),
  phone: z.string().min(5).max(30),
  dateOfBirth: z.iso.date().optional(),
  gender: z.enum(["male", "female"]).optional(),
  email: z.email().max(254).optional(),
});

export const guestBookInputSchema = z.object({
  doctorLocationId: z.string().uuid(),
  startsAt: z.iso.datetime(),
  patient: bookingPatientSchema,
  note: z.string().max(500).optional(),
});

/** Secretary walk-in (MM-DEC rev02 §9): find-or-create by phone, same shape. */
export const secretaryBookInputSchema = guestBookInputSchema;

export const bookResultSchema = z.object({
  appointmentId: z.string(),
  status: z.enum(APPOINTMENT_STATUSES),
  startsAt: z.string(),
  endsAt: z.string(),
  /** False when the phone already had a patient profile (found, not created). */
  patientProfileCreated: z.boolean(),
});

export const appointmentIdInputSchema = z.object({ appointmentId: z.string().uuid() });

export const cancelAppointmentInputSchema = z.object({
  appointmentId: z.string().uuid(),
  reason: z.string().max(500).optional(),
});

export const rescheduleAppointmentInputSchema = z.object({
  appointmentId: z.string().uuid(),
  newStartsAt: z.iso.datetime(),
});

export const transitionResultSchema = z.object({
  appointmentId: z.string(),
  status: z.enum(APPOINTMENT_STATUSES),
});

export const rescheduleResultSchema = z.object({
  appointmentId: z.string(),
  status: z.enum(APPOINTMENT_STATUSES),
  startsAt: z.string(),
  endsAt: z.string(),
});

// ── Availability ───────────────────────────────────────────────────────

export const weekAvailabilityInputSchema = z.object({
  doctorLocationId: z.string().uuid(),
  /** Any instant within the desired week; defaults to now. */
  anchor: z.iso.datetime().optional(),
});

export const availabilitySlotSchema = z.object({
  startsAt: z.string(),
  endsAt: z.string(),
});

export const availabilityDaySchema = z.object({
  /** YYYY-MM-DD calendar date in the location timezone. */
  date: z.string(),
  dayOfWeek: z.number().int().min(0).max(6),
  isOpen: z.boolean(),
  isToday: z.boolean(),
  isPast: z.boolean(),
  slots: z.array(availabilitySlotSchema),
});

export const weekAvailabilityOutputSchema = z.object({
  doctorLocationId: z.string(),
  timeZone: z.string(),
  days: z.array(availabilityDaySchema).length(7),
});

// ── Patient reads ──────────────────────────────────────────────────────

export const appointmentListItemSchema = z.object({
  appointmentId: z.string(),
  doctorLocationId: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  status: z.enum(APPOINTMENT_STATUSES),
  bookedVia: z.enum(BOOKING_CHANNELS),
});

export const myAppointmentsOutputSchema = z.object({
  appointments: z.array(appointmentListItemSchema),
});

// ── Clinic reads (Phase 8 dashboards) ──────────────────────────────────

export const clinicDayInputSchema = z.object({
  doctorLocationId: z.string().uuid(),
  /** Any instant within the desired day (location timezone); defaults to now. */
  anchor: z.iso.datetime().optional(),
});

export const clinicAppointmentItemSchema = z.object({
  appointmentId: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  status: z.enum(APPOINTMENT_STATUSES),
  bookedVia: z.enum(BOOKING_CHANNELS),
  patientProfileId: z.string(),
  /** Null when the patient profile has been removed (hard-delete precedent, ADR-0010). */
  patientName: z.string().nullable(),
  patientPhone: z.string().nullable(),
  note: z.string().nullable(),
});

export const clinicDayOutputSchema = z.object({
  doctorLocationId: z.string(),
  timeZone: z.string(),
  /** YYYY-MM-DD calendar date of the returned day in the location timezone. */
  date: z.string(),
  appointments: z.array(clinicAppointmentItemSchema),
});
