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

/** The status each action transitions an appointment to. */
export const ACTION_TARGET_STATUS: Record<AppointmentAction, AppointmentStatus> = {
  confirm: "confirmed",
  checkIn: "checked_in",
  start: "in_progress",
  complete: "completed",
  noShow: "no_show",
  cancel: "cancelled",
};

/** The actor allow-list gating each action — the booking router passes these same objects to its commands. */
export const ACTION_ALLOWED_ACTORS: Record<AppointmentAction, readonly AppointmentActorKind[]> = {
  confirm: CLINIC_SIDE,
  checkIn: FRONT_DESK,
  start: DOCTOR_ONLY,
  complete: DOCTOR_ONLY,
  noShow: CLINIC_SIDE,
  cancel: ANY_PARTY,
};

/**
 * Actions the given actor bindings may take on an appointment in `status`:
 * the transition must be legal AND at least one binding must be on the
 * action's allow-list. Result order follows the APPOINTMENT_ACTIONS
 * declaration (stable for clients).
 */
export function allowedAppointmentActions(
  status: AppointmentStatus,
  actors: readonly AppointmentActorKind[],
): AppointmentAction[] {
  return APPOINTMENT_ACTIONS.filter(
    (action) =>
      canTransition(status, ACTION_TARGET_STATUS[action]) &&
      ACTION_ALLOWED_ACTORS[action].some((kind) => actors.includes(kind)),
  );
}
