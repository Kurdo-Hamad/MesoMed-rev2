import { describe, expect, it } from "vitest";

import { isPlaceholderEmail, placeholderEmailForPhone } from "./placeholder-email.js";

describe("placeholder emails for phone-keyed accounts", () => {
  it("derives a deterministic placeholder from a normalized phone", () => {
    expect(placeholderEmailForPhone("+9647701234567")).toBe(
      "p9647701234567@phone.mesomed.invalid",
    );
  });

  it("uses the reserved .invalid TLD so mail can never route", () => {
    expect(placeholderEmailForPhone("+12025550123")).toMatch(/@phone\.mesomed\.invalid$/);
  });

  it("recognizes its own placeholders and nothing else", () => {
    expect(isPlaceholderEmail(placeholderEmailForPhone("+9647701234567"))).toBe(true);
    expect(isPlaceholderEmail("doctor@example.com")).toBe(false);
    expect(isPlaceholderEmail("p123@phone.mesomed.invalid.example.com")).toBe(false);
  });
});
