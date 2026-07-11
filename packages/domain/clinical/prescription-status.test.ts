import { describe, expect, it } from "vitest";
import { PRESCRIPTION_STATUSES, validatePrescriptionTransition } from "./prescription-status.js";

describe("validatePrescriptionTransition", () => {
  it("allows active → superseded (amendment)", () => {
    expect(validatePrescriptionTransition("active", "superseded")).toEqual({ ok: true });
  });

  it("allows active → discontinued", () => {
    expect(validatePrescriptionTransition("active", "discontinued")).toEqual({ ok: true });
  });

  it("rejects any transition out of a non-active revision", () => {
    expect(validatePrescriptionTransition("superseded", "active")).toEqual({
      ok: false,
      reason: "not_active",
    });
    expect(validatePrescriptionTransition("superseded", "discontinued")).toEqual({
      ok: false,
      reason: "not_active",
    });
    expect(validatePrescriptionTransition("discontinued", "active")).toEqual({
      ok: false,
      reason: "not_active",
    });
    expect(validatePrescriptionTransition("discontinued", "superseded")).toEqual({
      ok: false,
      reason: "not_active",
    });
  });

  it("rejects active → active (self-transition)", () => {
    expect(validatePrescriptionTransition("active", "active")).toEqual({
      ok: false,
      reason: "illegal_target",
    });
  });

  it("covers the whole status matrix: exactly two legal transitions", () => {
    const legal = PRESCRIPTION_STATUSES.flatMap((from) =>
      PRESCRIPTION_STATUSES.filter((to) => validatePrescriptionTransition(from, to).ok).map(
        (to) => `${from}->${to}`,
      ),
    );
    expect(legal.sort()).toEqual(["active->discontinued", "active->superseded"]);
  });
});
