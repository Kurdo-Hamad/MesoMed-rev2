/**
 * Server-computed lifecycle affordances (MM-QA-003 F-07): which actions an
 * actor may take on an appointment in a given status. Derived from the
 * transition map and the SAME allow-list objects the booking router hands
 * its commands, so UI affordance and layer-b authz cannot drift. Pure
 * functions only (no DB, no session).
 */
import { APPOINTMENT_ACTIONS, type AppointmentAction } from "@mesomed/contracts/booking";
import { canTransition, type AppointmentStatus } from "./transitions.js";

/** Layer-b actor bindings (§3.6) appointment actions are allowed for. */
export type AppointmentActorKind =
  "admin" | "owning_doctor" | "assigned_secretary" | "patient_owner";

export const CLINIC_SIDE: readonly AppointmentActorKind[] = [
  "assigned_secretary",
  "owning_doctor",
  "admin",
];
export const FRONT_DESK: readonly AppointmentActorKind[] = ["assigned_secretary", "admin"];
export const DOCTOR_ONLY: readonly AppointmentActorKind[] = ["owning_doctor", "admin"];
export const ANY_PARTY: readonly AppointmentActorKind[] = [
  "patient_owner",
  "assigned_secretary",
  "owning_doctor",
  "admin",
];

/**
 * The single edge table (MM-DES-002 §2): for every action, the statuses it
 * is legal FROM, the status it lands IN, and the actor allow-list gating
 * it. Affordance computation (below) and the transitionAppointment command
 * both read THIS record, so UI affordance and layer-b authz cannot drift.
 * Sources are explicit because target alone cannot disambiguate actions
 * sharing a target (recall and checkIn both land in checked_in); a unit
 * test proves every source/target pair is a legal map transition.
 */
export const APPOINTMENT_ACTION_EDGES: Record<
  AppointmentAction,
  {
    sources: readonly AppointmentStatus[];
    target: AppointmentStatus;
    actors: readonly AppointmentActorKind[];
  }
> = {
  confirm: { sources: ["booked"], target: "confirmed", actors: CLINIC_SIDE },
  checkIn: { sources: ["confirmed"], target: "checked_in", actors: FRONT_DESK },
  start: { sources: ["checked_in"], target: "in_progress", actors: DOCTOR_ONLY },
  complete: { sources: ["in_progress"], target: "completed", actors: DOCTOR_ONLY },
  noShow: {
    sources: ["confirmed", "checked_in", "delayed"],
    target: "no_show",
    actors: CLINIC_SIDE,
  },
  cancel: { sources: ["booked", "confirmed", "delayed"], target: "cancelled", actors: ANY_PARTY },
  delay: { sources: ["confirmed", "checked_in"], target: "delayed", actors: CLINIC_SIDE },
  recall: { sources: ["delayed"], target: "checked_in", actors: CLINIC_SIDE },
};

/**
 * Actions the given actor bindings may take on an appointment in `status`:
 * the status must be an edge source AND at least one binding must be on
 * the edge's allow-list. canTransition is retained as a consistency
 * assertion against the transition map. Result order follows the
 * APPOINTMENT_ACTIONS declaration (stable for clients).
 */
export function allowedAppointmentActions(
  status: AppointmentStatus,
  actors: readonly AppointmentActorKind[],
): AppointmentAction[] {
  return APPOINTMENT_ACTIONS.filter((action) => {
    const edge = APPOINTMENT_ACTION_EDGES[action];
    return (
      edge.sources.includes(status) &&
      canTransition(status, edge.target) &&
      edge.actors.some((kind) => actors.includes(kind))
    );
  });
}
