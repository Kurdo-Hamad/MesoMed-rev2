import { describe, expect, it } from "vitest";
import { z } from "zod";
import { eventEnvelope } from "../src/events/index.js";

describe("eventEnvelope", () => {
  const schema = eventEnvelope("identity.user_registered", 1, z.object({ userId: z.string() }));

  it("parses a valid envelope", () => {
    const parsed = schema.parse({
      name: "identity.user_registered",
      version: 1,
      payload: { userId: "u1" },
    });
    expect(parsed.payload.userId).toBe("u1");
  });

  it("rejects a wrong event name", () => {
    expect(() =>
      schema.parse({ name: "identity.other", version: 1, payload: { userId: "u1" } }),
    ).toThrow();
  });

  it("rejects a wrong version (breaking change = new version, MM-PLAN-001 §3.3)", () => {
    expect(() =>
      schema.parse({ name: "identity.user_registered", version: 2, payload: { userId: "u1" } }),
    ).toThrow();
  });

  it("rejects an invalid payload", () => {
    expect(() =>
      schema.parse({ name: "identity.user_registered", version: 1, payload: {} }),
    ).toThrow();
  });
});
