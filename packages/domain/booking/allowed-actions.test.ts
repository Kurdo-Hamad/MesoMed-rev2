import { describe, expect, it } from "vitest";
import {
  ACTION_ALLOWED_ACTORS,
  ACTION_TARGET_STATUS,
  allowedAppointmentActions,
  type AppointmentActorKind,
} from "./allowed-actions.js";
import { APPOINTMENT_TRANSITIONS, type AppointmentStatus } from "./transitions.js";

/**
 * F-07 (MM-QA-003): the full status × actor matrix is pinned here so any
 * change to the transition map or an allow-list surfaces as an explicit
 * affordance diff, reviewed instead of drifting.
 */
const MATRIX: Record<AppointmentActorKind, Record<AppointmentStatus, string[]>> = {
  admin: {
    booked: ["confirm", "cancel"],
    confirmed: ["checkIn", "noShow", "cancel"],
    checked_in: ["start", "noShow"],
    in_progress: ["complete"],
    completed: [],
    cancelled: [],
    no_show: [],
  },
  owning_doctor: {
    booked: ["confirm", "cancel"],
    confirmed: ["noShow", "cancel"],
    checked_in: ["start", "noShow"],
    in_progress: ["complete"],
    completed: [],
    cancelled: [],
    no_show: [],
  },
  assigned_secretary: {
    booked: ["confirm", "cancel"],
    confirmed: ["checkIn", "noShow", "cancel"],
    checked_in: ["noShow"],
    in_progress: [],
    completed: [],
    cancelled: [],
    no_show: [],
  },
  patient_owner: {
    booked: ["cancel"],
    confirmed: ["cancel"],
    checked_in: [],
    in_progress: [],
    completed: [],
    cancelled: [],
    no_show: [],
  },
};

describe("allowedAppointmentActions", () => {
  for (const [actor, byStatus] of Object.entries(MATRIX) as Array<
    [AppointmentActorKind, Record<AppointmentStatus, string[]>]
  >) {
    it(`computes the full status matrix for ${actor}`, () => {
      for (const [status, expected] of Object.entries(byStatus)) {
        expect(allowedAppointmentActions(status as AppointmentStatus, [actor])).toEqual(expected);
      }
    });
  }

  it("unions actions across multiple bindings", () => {
    expect(allowedAppointmentActions("confirmed", ["owning_doctor", "assigned_secretary"])).toEqual(
      ["checkIn", "noShow", "cancel"],
    );
  });

  it("returns nothing for no bindings", () => {
    for (const status of Object.keys(APPOINTMENT_TRANSITIONS)) {
      expect(allowedAppointmentActions(status as AppointmentStatus, [])).toEqual([]);
    }
  });

  it("every action targets a status that some status can transition to", () => {
    const reachable = new Set(Object.values(APPOINTMENT_TRANSITIONS).flat());
    for (const [action, target] of Object.entries(ACTION_TARGET_STATUS)) {
      expect(reachable, `${action} targets unreachable status ${target}`).toContain(target);
    }
  });

  it("admin is on every allow-list (superset actor)", () => {
    for (const actors of Object.values(ACTION_ALLOWED_ACTORS)) {
      expect(actors).toContain("admin");
    }
  });
});
