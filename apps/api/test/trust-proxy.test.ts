import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { resolveTrustProxy } from "../src/app.js";

/**
 * ADR-0011 F-5: without `trustProxy` configured, every request behind a
 * reverse proxy resolves to the PROXY's own address — collapsing per-IP
 * guardrails (identity OTP send-rate, AI triage rate limit) onto one
 * shared bucket for every real caller. This proves both the env-value
 * parsing and the actual effect on Fastify's own IP resolution.
 */
describe("resolveTrustProxy (ADR-0011 F-5)", () => {
  it('defaults to false (trust nothing) when unset or explicitly "false"', () => {
    expect(resolveTrustProxy(undefined)).toBe(false);
    expect(resolveTrustProxy("false")).toBe(false);
  });

  it('parses "true" as boolean true (trust every hop)', () => {
    expect(resolveTrustProxy("true")).toBe(true);
  });

  it("parses a comma-separated list into a trimmed IP/CIDR allowlist", () => {
    expect(resolveTrustProxy("10.0.0.1, 10.0.0.2")).toEqual(["10.0.0.1", "10.0.0.2"]);
  });

  it("without trustProxy, req.ip collapses to the proxy's own address regardless of X-Forwarded-For", async () => {
    const app = Fastify({ trustProxy: resolveTrustProxy(undefined) });
    app.get("/ip", async (req) => ({ ip: req.ip }));
    await app.ready();
    try {
      const res = await app.inject({
        method: "GET",
        url: "/ip",
        headers: { "x-forwarded-for": "203.0.113.9" },
        remoteAddress: "10.0.0.1",
      });
      expect(JSON.parse(res.payload).ip).toBe("10.0.0.1");
    } finally {
      await app.close();
    }
  });

  it("with trustProxy set to the proxy's address, req.ip resolves to the real client from X-Forwarded-For", async () => {
    const app = Fastify({ trustProxy: resolveTrustProxy("10.0.0.1") });
    app.get("/ip", async (req) => ({ ip: req.ip }));
    await app.ready();
    try {
      const res = await app.inject({
        method: "GET",
        url: "/ip",
        headers: { "x-forwarded-for": "203.0.113.9" },
        remoteAddress: "10.0.0.1",
      });
      expect(JSON.parse(res.payload).ip).toBe("203.0.113.9");
    } finally {
      await app.close();
    }
  });
});
