/**
 * Booking module tRPC surface (MM-PLAN-001 §5 Phase 4). Guest booking is
 * public by design (MM-DEC rev02 §1); every lifecycle command is
 * role-gated at the kernel (§3.6 layer a) and actor-bound inside the
 * command (layer b). All I/O is typed by the contracts package
 * (§3.11/§3.12).
 *
 * Actor matrix (layer b, enforced in commands — lifecycle actions read
 * APPOINTMENT_ACTION_EDGES in the domain package, MM-DES-002 §2):
 *   secretaryBook  assigned secretary · admin
 *   confirm        assigned secretary · owning doctor · admin
 *   checkIn        assigned secretary · admin
 *   start          owning doctor · admin
 *   complete       owning doctor · admin
 *   noShow         assigned secretary · owning doctor · admin
 *   cancel         patient owner · assigned secretary · owning doctor · admin
 *   delay          assigned secretary · owning doctor · admin
 *   recall         assigned secretary · owning doctor · admin
 *   reschedule     patient owner · assigned secretary · owning doctor · admin
 *                  (from delayed: clinic-side only — D4a, enforced in the command)
 */
import {
  appointmentIdInputSchema,
  bookResultSchema,
  cancelAppointmentInputSchema,
  clinicDayInputSchema,
  clinicDayOutputSchema,
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
import { getClinicDay } from "./queries/clinic-day.js";
import { getWeekAvailability } from "./queries/week-availability.js";
import { listMyAppointments } from "./queries/my-appointments.js";
import { isSecretaryAssigned } from "../scheduling/queries/schedule-inputs.js";

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
            action: "confirm",
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
            action: "checkIn",
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
            action: "start",
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
            action: "complete",
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
            action: "noShow",
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
            action: "cancel",
            reason: input.reason,
          }),
        ),
      ),

    /** Phase 9c (MM-DES-002): push a late patient down the queue by state. */
    delay: roleProcedure("secretary", "doctor", "admin")
      .input(appointmentIdInputSchema)
      .output(transitionResultSchema)
      .mutation(({ ctx, input }) =>
        ctx.db.transaction((tx) =>
          transitionAppointment(tx, ctx.outbox, ctx.session, {
            appointmentId: input.appointmentId,
            action: "delay",
          }),
        ),
      ),

    /** Phase 9c (MM-DES-002): the delayed patient arrived — back to checked_in. */
    recall: roleProcedure("secretary", "doctor", "admin")
      .input(appointmentIdInputSchema)
      .output(transitionResultSchema)
      .mutation(({ ctx, input }) =>
        ctx.db.transaction((tx) =>
          transitionAppointment(tx, ctx.outbox, ctx.session, {
            appointmentId: input.appointmentId,
            action: "recall",
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
          }),
        ),
      ),

    // ── Clinic reads (Phase 8 dashboards) ──────────────────────────────
    clinicDay: roleProcedure("doctor", "secretary", "admin")
      .input(clinicDayInputSchema)
      .output(clinicDayOutputSchema)
      .query(({ ctx, input }) => getClinicDay(ctx.db, ctx.session, input)),

    // ── Patient reads ──────────────────────────────────────────────────
    myAppointments: roleProcedure("patient")
      .output(myAppointmentsOutputSchema)
      .query(({ ctx }) => listMyAppointments(ctx.db, ctx.session.userId)),
  });
}
