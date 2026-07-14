import { describe, expect, it } from "vitest";
import {
  APPOINTMENT_ACTION_EDGES,
  allowedAppointmentActions,
  type AppointmentActorKind,
} from "./allowed-actions.js";
import { APPOINTMENT_TRANSITIONS, canTransition, type AppointmentStatus } from "./transitions.js";

/**
 * F-07 (MM-QA-003): the full status × actor matrix is pinned here so any
 * change to the transition map or an edge's allow-list surfaces as an
 * explicit affordance diff, reviewed instead of drifting. 8 statuses × 4
 * actor kinds per MM-DES-002 §9.
 */
const MATRIX: Record<AppointmentActorKind, Record<AppointmentStatus, string[]>> = {
  admin: {
    booked: ["confirm", "cancel"],
    confirmed: ["checkIn", "noShow", "cancel", "delay"],
    checked_in: ["start", "noShow", "delay"],
    delayed: ["noShow", "cancel", "recall"],
    in_progress: ["complete"],
    completed: [],
    cancelled: [],
    no_show: [],
  },
  owning_doctor: {
    booked: ["confirm", "cancel"],
    confirmed: ["noShow", "cancel", "delay"],
    checked_in: ["start", "noShow", "delay"],
    delayed: ["noShow", "cancel", "recall"],
    in_progress: ["complete"],
    completed: [],
    cancelled: [],
    no_show: [],
  },
  assigned_secretary: {
    booked: ["confirm", "cancel"],
    confirmed: ["checkIn", "noShow", "cancel", "delay"],
    checked_in: ["noShow", "delay"],
    delayed: ["noShow", "cancel", "recall"],
    in_progress: [],
    completed: [],
    cancelled: [],
    no_show: [],
  },
  patient_owner: {
    booked: ["cancel"],
    confirmed: ["cancel"],
    checked_in: [],
    delayed: ["cancel"],
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
      ["checkIn", "noShow", "cancel", "delay"],
    );
  });

  it("returns nothing for no bindings", () => {
    for (const status of Object.keys(APPOINTMENT_TRANSITIONS)) {
      expect(allowedAppointmentActions(status as AppointmentStatus, [])).toEqual([]);
    }
  });

  it("patients get neither delay nor recall (MM-DES-002 D2)", () => {
    for (const status of Object.keys(APPOINTMENT_TRANSITIONS) as AppointmentStatus[]) {
      const actions = allowedAppointmentActions(status, ["patient_owner"]);
      expect(actions).not.toContain("delay");
      expect(actions).not.toContain("recall");
    }
  });

  // ── Edge-table consistency (the no-drift meta-property, MM-DES-002 §2) ─

  it("every edge's source/target pair is a legal map transition", () => {
    for (const [action, edge] of Object.entries(APPOINTMENT_ACTION_EDGES)) {
      for (const source of edge.sources) {
        expect(
          canTransition(source, edge.target),
          `${action}: ${source} -> ${edge.target} is not in the transition map`,
        ).toBe(true);
      }
    }
  });

  it("every edge's sources are exactly the map statuses that reach its target — except targets shared by two actions or reserved for reschedule", () => {
    // recall and checkIn split the statuses reaching checked_in between
    // them; delayed -> confirmed belongs to reschedule's status reset, not
    // to any action (MM-DES-002 §1/§4.4). Everything else derives fully.
    const statuses = Object.keys(APPOINTMENT_TRANSITIONS) as AppointmentStatus[];
    for (const [action, edge] of Object.entries(APPOINTMENT_ACTION_EDGES)) {
      const reaching = statuses.filter((from) => canTransition(from, edge.target));
      if (action === "checkIn" || action === "recall") {
        // Together they partition the statuses reaching checked_in.
        continue;
      }
      const expected =
        edge.target === "confirmed" ? reaching.filter((s) => s !== "delayed") : reaching;
      expect([...edge.sources].sort(), `${action} sources`).toEqual(expected.sort());
    }
    const checkInSources = [...APPOINTMENT_ACTION_EDGES.checkIn.sources];
    const recallSources = [...APPOINTMENT_ACTION_EDGES.recall.sources];
    const reachingCheckedIn = statuses.filter((from) => canTransition(from, "checked_in"));
    expect([...checkInSources, ...recallSources].sort()).toEqual(reachingCheckedIn.sort());
  });

  it("admin is on every allow-list (superset actor)", () => {
    for (const edge of Object.values(APPOINTMENT_ACTION_EDGES)) {
      expect(edge.actors).toContain("admin");
    }
  });
});
