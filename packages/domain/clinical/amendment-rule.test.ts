import { describe, expect, it } from "vitest";
import { validateAmendmentTarget } from "./amendment-rule.js";

describe("validateAmendmentTarget", () => {
  it("allows amending an original note", () => {
    expect(validateAmendmentTarget({ encounterId: "e1", amendsNoteId: null })).toEqual({
      ok: true,
    });
  });

  it("rejects amending an amendment — chains stay one level deep", () => {
    expect(validateAmendmentTarget({ encounterId: "e1", amendsNoteId: "n1" })).toEqual({
      ok: false,
      reason: "target_is_amendment",
    });
  });
});
