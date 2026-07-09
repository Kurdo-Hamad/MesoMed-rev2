import { describe, expect, it } from "vitest";
import { healthResponseSchema } from "../src/health.js";

describe("healthResponseSchema", () => {
  it("parses a valid health payload", () => {
    const result = healthResponseSchema.parse({
      status: "ok",
      service: "api",
      timestamp: new Date().toISOString(),
    });
    expect(result.status).toBe("ok");
  });

  it("rejects an invalid status", () => {
    expect(() =>
      healthResponseSchema.parse({
        status: "degraded",
        service: "api",
        timestamp: new Date().toISOString(),
      }),
    ).toThrow();
  });
});
