import { describe, expect, it } from "vitest";
import { isBookableCategory } from "../lib/category-filter.js";

/**
 * MM-QA-005 F-02: mobile must exclude `coming_soon` categories from the
 * directory grid until the tile surface lands (ADR-0055 §8 correction).
 */
describe("isBookableCategory", () => {
  it("excludes a coming_soon category", () => {
    expect(isBookableCategory({ active: true, status: "coming_soon" })).toBe(false);
  });

  it("includes an active category", () => {
    expect(isBookableCategory({ active: true, status: "active" })).toBe(true);
  });

  it("includes a category with no status field (fail-open, matching packages/config)", () => {
    expect(isBookableCategory({ active: true })).toBe(true);
  });

  it("excludes an inactive category regardless of status", () => {
    expect(isBookableCategory({ active: false, status: "active" })).toBe(false);
  });
});
