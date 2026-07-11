import { describe, expect, it } from "vitest";
import { TREATING_APPOINTMENT_STATUSES, hasTreatingStatus } from "./treating-relationship.js";

describe("hasTreatingStatus", () => {
  it("each treating status establishes the relationship on its own", () => {
    for (const status of TREATING_APPOINTMENT_STATUSES) {
      expect(hasTreatingStatus([status])).toBe(true);
    }
  });

  it("a merely booked appointment is sufficient (continuity of care starts at booking)", () => {
    expect(hasTreatingStatus(["booked"])).toBe(true);
  });

  it("cancelled and no_show never establish a relationship", () => {
    expect(hasTreatingStatus(["cancelled"])).toBe(false);
    expect(hasTreatingStatus(["no_show"])).toBe(false);
    expect(hasTreatingStatus(["cancelled", "no_show"])).toBe(false);
  });

  it("one treating status among terminal ones is enough", () => {
    expect(hasTreatingStatus(["cancelled", "no_show", "completed"])).toBe(true);
  });

  it("no appointments → no relationship", () => {
    expect(hasTreatingStatus([])).toBe(false);
  });
});
