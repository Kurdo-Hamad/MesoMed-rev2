import { describe, it, expect } from "vitest";
import { encodeEncounterCursor, decodeEncounterCursor } from "./encounter-cursor.js";

const VALID = {
  s: "2026-07-01T09:00:00.000Z",
  i: "00000000-0000-4000-9d00-000000000001",
};

describe("encounter cursor codec", () => {
  it("round-trips a valid cursor", () => {
    expect(decodeEncounterCursor(encodeEncounterCursor(VALID))).toEqual(VALID);
  });

  it("returns null (page one) for null/empty input", () => {
    expect(decodeEncounterCursor(null)).toBeNull();
    expect(decodeEncounterCursor(undefined)).toBeNull();
    expect(decodeEncounterCursor("")).toBeNull();
  });

  it("returns null for garbage that is not base64url JSON", () => {
    expect(decodeEncounterCursor("not-a-cursor")).toBeNull();
    expect(decodeEncounterCursor("%%%%")).toBeNull();
  });

  it("returns null for valid JSON with the wrong shape", () => {
    const raw = Buffer.from(JSON.stringify({ hello: "world" })).toString("base64url");
    expect(decodeEncounterCursor(raw)).toBeNull();
  });

  it("returns null when the id is not a uuid (tamper defense)", () => {
    const raw = Buffer.from(
      JSON.stringify({ ...VALID, i: "1; DROP TABLE encounters;--" }),
    ).toString("base64url");
    expect(decodeEncounterCursor(raw)).toBeNull();
  });

  it("returns null when starts_at is not an ISO instant", () => {
    const raw = Buffer.from(JSON.stringify({ ...VALID, s: "next tuesday" })).toString("base64url");
    expect(decodeEncounterCursor(raw)).toBeNull();
  });
});
