import type { FastifyInstance } from "fastify";
import { encounters, eq } from "@mesomed/db";
import { waitFor } from "../helpers.js";
import {
  openSlotsNextWeek,
  result,
  trpc,
  type CallOptions,
  type ClinicFixture,
} from "../booking/helpers.js";

/**
 * Phase 5 fixtures ride on the Phase 4 clinic fixture: drive a real
 * appointment through its lifecycle to `completed`, then wait for the
 * outbox dispatcher to deliver booking.completed.v1 to the clinical
 * subscriber — the ONLY path that creates an encounter.
 */
export interface CompletedVisit {
  appointmentId: string;
  encounterId: string;
}

export function doctorSession(clinic: ClinicFixture): CallOptions {
  return { roles: "doctor", user: clinic.doctorUserId };
}

export function secretarySession(clinic: ClinicFixture): CallOptions {
  return { roles: "secretary", user: clinic.secretaryUserId };
}

export function patientSession(clinic: ClinicFixture): CallOptions {
  return { roles: "patient", user: clinic.patientUserId };
}

export const ADMIN_USER = { roles: "admin", user: "admin-under-test" } satisfies CallOptions;

let visitCounter = 0;

export async function completeAppointment(
  app: FastifyInstance,
  clinic: ClinicFixture,
  options: { phone?: string } = {},
): Promise<CompletedVisit> {
  const phone = options.phone ?? clinic.patientPhone;

  const slots = await openSlotsNextWeek(app, clinic.doctorLocationId);
  const slot = slots[visitCounter++ % slots.length];
  if (!slot) throw new Error("No open slot available for fixture booking");

  async function mutate(procedure: string, input: unknown, session?: CallOptions) {
    const res = await trpc(app, procedure, "mutation", input, session);
    if (res.statusCode !== 200) {
      throw new Error(`${procedure} failed in fixture: ${res.statusCode} ${res.body}`);
    }
    return res;
  }

  const booked = await mutate("booking.guestBook", {
    doctorLocationId: clinic.doctorLocationId,
    startsAt: slot.startsAt,
    patient: { fullName: "Encounter Patient", phone },
  });
  const { appointmentId } = result<{ appointmentId: string }>(booked);

  await mutate("booking.confirm", { appointmentId }, secretarySession(clinic));
  await mutate("booking.checkIn", { appointmentId }, secretarySession(clinic));
  await mutate("booking.start", { appointmentId }, doctorSession(clinic));
  await mutate("booking.complete", { appointmentId }, doctorSession(clinic));

  // The dispatcher delivers asynchronously — wait for the subscriber.
  const encounter = await waitFor(async () => {
    const [row] = await app.kernel.db
      .select({ id: encounters.id })
      .from(encounters)
      .where(eq(encounters.appointmentId, appointmentId));
    return row;
  });

  return { appointmentId, encounterId: encounter.id };
}

/** Extract the typed appCode of a failed tRPC response. */
export function appCode(res: { json(): unknown }): string {
  return (res.json() as { error: { data: { appCode: string } } }).error.data.appCode;
}
