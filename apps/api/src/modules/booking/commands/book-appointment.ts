/**
 * Booking creation (MM-PLAN-001 §5 Phase 4). One core command backs both
 * entry points:
 *  - guest web booking (MM-DEC rev02 §1): no account, no OTP — the
 *    identity module's published find-or-create keys the patient profile
 *    on the normalized phone;
 *  - secretary walk-in (MM-DEC rev02 §9): same find-or-create, actor
 *    recorded, channel `secretary_walk_in`.
 *
 * Slot validation, the profile write, the appointment insert and the
 * booking.booked.v1 outbox row share one transaction (§3.2/§3.4); the
 * partial unique index turns a concurrent duplicate into a typed
 * SLOT_UNAVAILABLE.
 */
import type { z } from "zod";
import type { guestBookInputSchema } from "@mesomed/contracts/booking";
import type { BookingChannel } from "@mesomed/contracts/booking";
import { ErrorCode } from "@mesomed/contracts/errors";
import { appointments, type DbTransaction } from "@mesomed/db";
import { AppError } from "../../../kernel/errors.js";
import type { OutboxEmitter } from "../../../kernel/outbox.js";
import type { createGuestPatientProfile } from "../../identity/commands/create-guest-patient-profile.js";
import {
  appointmentSnapshot,
  bookingEvent,
  isSlotUniqueViolation,
  requireBookableDoctorLocation,
  resolveBookableSlot,
  type AppointmentRow,
} from "../shared.js";

export type BookAppointmentInput = z.output<typeof guestBookInputSchema> & {
  bookedVia: BookingChannel;
  /** Identity user id of the acting session; null for guests. */
  createdBy: string | null;
};

/**
 * The identity module's published find-or-create, injected by the
 * composition seam (trpc/router.ts): cross-module writes stay out of
 * module import graphs (§3.1) — the profile write is identity's code
 * running on booking's transaction, wired where all modules meet.
 */
export type CreateGuestPatientProfile = typeof createGuestPatientProfile;

export interface BookAppointmentResult {
  appointmentId: string;
  status: "booked";
  startsAt: string;
  endsAt: string;
  patientProfileCreated: boolean;
}

export async function bookAppointment(
  tx: DbTransaction,
  outbox: OutboxEmitter,
  createGuestPatientProfile: CreateGuestPatientProfile,
  input: BookAppointmentInput,
): Promise<BookAppointmentResult> {
  const doctorLocation = await requireBookableDoctorLocation(tx, input.doctorLocationId);
  const slot = await resolveBookableSlot(tx, doctorLocation, new Date(input.startsAt));

  const profile = await createGuestPatientProfile(tx, outbox, input.patient);

  let inserted: { id: string } | undefined;
  try {
    [inserted] = await tx
      .insert(appointments)
      .values({
        doctorLocationId: doctorLocation.doctorLocationId,
        patientProfileId: profile.profileId,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        status: "booked",
        bookedVia: input.bookedVia,
        createdBy: input.createdBy,
        note: input.note ?? null,
      })
      .returning({ id: appointments.id });
  } catch (error) {
    if (isSlotUniqueViolation(error)) {
      throw new AppError(ErrorCode.SLOT_UNAVAILABLE, "This slot is already booked", {
        cause: error,
      });
    }
    throw error;
  }
  if (!inserted) throw new AppError(ErrorCode.INTERNAL, "Appointment insert returned no row");

  const row: AppointmentRow = {
    id: inserted.id,
    doctorLocationId: doctorLocation.doctorLocationId,
    patientProfileId: profile.profileId,
    startsAt: slot.startsAt,
    endsAt: slot.endsAt,
    status: "booked",
    bookedVia: input.bookedVia,
  };
  await outbox.emit(
    tx,
    bookingEvent("booking.booked.v1", appointmentSnapshot(row, doctorLocation), row.id),
  );

  return {
    appointmentId: row.id,
    status: "booked",
    startsAt: slot.startsAt.toISOString(),
    endsAt: slot.endsAt.toISOString(),
    patientProfileCreated: profile.created,
  };
}
