/**
 * Booking module tRPC surface (MM-PLAN-001 §5 Phase 4). Guest booking is
 * public by design (MM-DEC rev02 §1); every lifecycle command is
 * role-gated at the kernel (§3.6 layer a) and actor-bound inside the
 * command (layer b). All I/O is typed by the contracts package
 * (§3.11/§3.12).
 *
 * Actor matrix (layer b, enforced in commands):
 *   secretaryBook  assigned secretary · admin
 *   confirm        assigned secretary · owning doctor · admin
 *   checkIn        assigned secretary · admin
 *   start          owning doctor · admin
 *   complete       owning doctor · admin
 *   noShow         assigned secretary · owning doctor · admin
 *   cancel         patient owner · assigned secretary · owning doctor · admin
 *   reschedule     patient owner · assigned secretary · owning doctor · admin
 */
import {
  appointmentIdInputSchema,
  bookResultSchema,
  cancelAppointmentInputSchema,
  guestBookInputSchema,
  myAppointmentsOutputSchema,
  rescheduleAppointmentInputSchema,
  rescheduleResultSchema,
  secretaryBookInputSchema,
  transitionResultSchema,
  weekAvailabilityInputSchema,
  weekAvailabilityOutputSchema,
} from "@mesomed/contracts/booking";
import { ErrorCode } from "@mesomed/contracts/errors";
import { roleProcedure } from "../../kernel/authz.js";
import { AppError } from "../../kernel/errors.js";
import { publicProcedure, router } from "../../kernel/trpc.js";
import { bookAppointment, type CreateGuestPatientProfile } from "./commands/book-appointment.js";
import { rescheduleAppointment } from "./commands/reschedule-appointment.js";
import { transitionAppointment } from "./commands/transition-appointment.js";
import { getWeekAvailability } from "./queries/week-availability.js";
import { listMyAppointments } from "./queries/my-appointments.js";
import { isSecretaryAssigned } from "../scheduling/queries/schedule-inputs.js";
import type { AppointmentActor } from "./shared.js";

const CLINIC_SIDE: readonly AppointmentActor[] = ["assigned_secretary", "owning_doctor", "admin"];
const FRONT_DESK: readonly AppointmentActor[] = ["assigned_secretary", "admin"];
const DOCTOR_ONLY: readonly AppointmentActor[] = ["owning_doctor", "admin"];
const ANY_PARTY: readonly AppointmentActor[] = [
  "patient_owner",
  "assigned_secretary",
  "owning_doctor",
  "admin",
];

export interface BookingRouterDeps {
  /** Identity's published find-or-create — see CreateGuestPatientProfile. */
  createGuestPatientProfile: CreateGuestPatientProfile;
}

export function createBookingRouter({ createGuestPatientProfile }: BookingRouterDeps) {
  return router({
    // ── Public ─────────────────────────────────────────────────────────
    weekAvailability: publicProcedure
      .input(weekAvailabilityInputSchema)
      .output(weekAvailabilityOutputSchema)
      .query(({ ctx, input }) => getWeekAvailability(ctx.db, input)),

    /** Guest booking: no account, no OTP (MM-DEC rev02 §1). */
    guestBook: publicProcedure
      .input(guestBookInputSchema)
      .output(bookResultSchema)
      .mutation(({ ctx, input }) =>
        ctx.db.transaction((tx) =>
          bookAppointment(tx, ctx.outbox, createGuestPatientProfile, {
            ...input,
            bookedVia: "guest_web",
            createdBy: null,
          }),
        ),
      ),

    // ── Front desk ─────────────────────────────────────────────────────
    /** Walk-in find-or-create booking (MM-DEC rev02 §9). */
    secretaryBook: roleProcedure("secretary", "admin")
      .input(secretaryBookInputSchema)
      .output(bookResultSchema)
      .mutation(async ({ ctx, input }) => {
        // Layer b before any write: assignment to this doctor-location
        // (admin passes unconditionally).
        if (!ctx.session.roles.includes("admin")) {
          const assigned = await isSecretaryAssigned(
            ctx.db,
            ctx.session.userId,
            input.doctorLocationId,
          );
          if (!assigned) {
            throw new AppError(ErrorCode.FORBIDDEN, "Not assigned to this doctor location");
          }
        }
        return ctx.db.transaction((tx) =>
          bookAppointment(tx, ctx.outbox, createGuestPatientProfile, {
            ...input,
            bookedVia: "secretary_walk_in",
            createdBy: ctx.session.userId,
          }),
        );
      }),

    confirm: roleProcedure("secretary", "doctor", "admin")
      .input(appointmentIdInputSchema)
      .output(transitionResultSchema)
      .mutation(({ ctx, input }) =>
        ctx.db.transaction((tx) =>
          transitionAppointment(tx, ctx.outbox, ctx.session, {
            appointmentId: input.appointmentId,
            to: "confirmed",
            allowedActors: CLINIC_SIDE,
          }),
        ),
      ),

    checkIn: roleProcedure("secretary", "admin")
      .input(appointmentIdInputSchema)
      .output(transitionResultSchema)
      .mutation(({ ctx, input }) =>
        ctx.db.transaction((tx) =>
          transitionAppointment(tx, ctx.outbox, ctx.session, {
            appointmentId: input.appointmentId,
            to: "checked_in",
            allowedActors: FRONT_DESK,
          }),
        ),
      ),

    start: roleProcedure("doctor", "admin")
      .input(appointmentIdInputSchema)
      .output(transitionResultSchema)
      .mutation(({ ctx, input }) =>
        ctx.db.transaction((tx) =>
          transitionAppointment(tx, ctx.outbox, ctx.session, {
            appointmentId: input.appointmentId,
            to: "in_progress",
            allowedActors: DOCTOR_ONLY,
          }),
        ),
      ),

    complete: roleProcedure("doctor", "admin")
      .input(appointmentIdInputSchema)
      .output(transitionResultSchema)
      .mutation(({ ctx, input }) =>
        ctx.db.transaction((tx) =>
          transitionAppointment(tx, ctx.outbox, ctx.session, {
            appointmentId: input.appointmentId,
            to: "completed",
            allowedActors: DOCTOR_ONLY,
          }),
        ),
      ),

    noShow: roleProcedure("secretary", "doctor", "admin")
      .input(appointmentIdInputSchema)
      .output(transitionResultSchema)
      .mutation(({ ctx, input }) =>
        ctx.db.transaction((tx) =>
          transitionAppointment(tx, ctx.outbox, ctx.session, {
            appointmentId: input.appointmentId,
            to: "no_show",
            allowedActors: CLINIC_SIDE,
          }),
        ),
      ),

    cancel: roleProcedure("patient", "secretary", "doctor", "admin")
      .input(cancelAppointmentInputSchema)
      .output(transitionResultSchema)
      .mutation(({ ctx, input }) =>
        ctx.db.transaction((tx) =>
          transitionAppointment(tx, ctx.outbox, ctx.session, {
            appointmentId: input.appointmentId,
            to: "cancelled",
            allowedActors: ANY_PARTY,
            reason: input.reason,
          }),
        ),
      ),

    reschedule: roleProcedure("patient", "secretary", "doctor", "admin")
      .input(rescheduleAppointmentInputSchema)
      .output(rescheduleResultSchema)
      .mutation(({ ctx, input }) =>
        ctx.db.transaction((tx) =>
          rescheduleAppointment(tx, ctx.outbox, ctx.session, {
            appointmentId: input.appointmentId,
            newStartsAt: input.newStartsAt,
            allowedActors: ANY_PARTY,
          }),
        ),
      ),

    // ── Patient reads ──────────────────────────────────────────────────
    myAppointments: roleProcedure("patient")
      .output(myAppointmentsOutputSchema)
      .query(({ ctx }) => listMyAppointments(ctx.db, ctx.session.userId)),
  });
}
