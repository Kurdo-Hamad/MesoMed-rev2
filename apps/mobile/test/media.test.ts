import { describe, expect, it } from "vitest";
import { mediaUrl } from "../lib/media.js";

/**
 * MM-QA-004 F-14: mediaUrl resolution. Under the test stub for
 * expo-constants (test/stubs/expo-constants.ts) no mediaUrl is
 * configured, so the module falls back to its default origin — the
 * fallback path itself is part of the contract.
 */
describe("mediaUrl", () => {
  it("prefixes host-relative paths with the media origin", () => {
    expect(mediaUrl("/uploads/a.jpg")).toBe("http://localhost:4000/uploads/a.jpg");
  });

  it("inserts a slash for bare relative paths", () => {
    expect(mediaUrl("uploads/a.jpg")).toBe("http://localhost:4000/uploads/a.jpg");
  });

  it("passes absolute http/https URLs through untouched", () => {
    expect(mediaUrl("http://cdn.example/x.png")).toBe("http://cdn.example/x.png");
    expect(mediaUrl("https://cdn.example/x.png")).toBe("https://cdn.example/x.png");
  });

  it("does not treat protocol-ish prefixes as absolute", () => {
    expect(mediaUrl("httpx/y.png")).toBe("http://localhost:4000/httpx/y.png");
  });
});
