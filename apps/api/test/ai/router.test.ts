import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { AI_TRIAGE_RATE_POLICY_CONFIG_KEY, aiTriageRatePolicySchema } from "@mesomed/config";
import type { Role } from "@mesomed/contracts/roles";
import { createMockAiGateway } from "@mesomed/platform";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import { buildServer } from "../../src/app.js";
import { testEnv } from "../helpers.js";

interface CallOptions {
  roles?: string;
  user?: string;
}

async function trpc(app: FastifyInstance, kind: "query" | "mutation", input: unknown, options: CallOptions = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.roles !== undefined) headers["x-test-roles"] = options.roles;
  if (options.user !== undefined) headers["x-test-user"] = options.user;
  if (kind === "query") {
    return app.inject({
      method: "GET",
      url: `/trpc/ai.triageSymptoms?input=${encodeURIComponent(JSON.stringify(input))}`,
      headers,
    });
  }
  return app.inject({
    method: "POST",
    url: "/trpc/ai.triageSymptoms",
    headers,
    payload: JSON.stringify(input),
  });
}

describe("ai.triageSymptoms router (MM-PLAN-001 §5 Phase 7)", () => {
  let tdb: TestDatabase;
  let app: FastifyInstance;

  beforeAll(async () => {
    tdb = await createTestDatabase();
    app = await buildServer(testEnv(tdb.connectionString), {
      aiGateway: createMockAiGateway(),
      sessionResolver: (req) => {
        const roleHeader = req.headers["x-test-roles"];
        const roles = Array.isArray(roleHeader) ? roleHeader[0] : roleHeader;
        if (roles === undefined) return null;
        const userHeader = req.headers["x-test-user"];
        const userId = (Array.isArray(userHeader) ? userHeader[0] : userHeader) ?? "user-under-test";
        return { userId, roles: roles === "" ? [] : (roles.split(",") as Role[]) };
      },
    });
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await tdb.close();
  });

  it("is public — no session required — and matches the output contract", async () => {
    const res = await trpc(app, "mutation", { text: "a mild persistent headache" });
    expect(res.statusCode).toBe(200);
    const data = res.json().result.data as { redFlag: boolean; specialties: string[]; engine: string };
    expect(typeof data.redFlag).toBe("boolean");
    expect(Array.isArray(data.specialties)).toBe(true);
    expect(["model", "keyword", "red_flag"]).toContain(data.engine);
  });

  it("rejects empty input (contract test)", async () => {
    const res = await trpc(app, "mutation", { text: "" });
    expect(res.statusCode).toBe(400);
  });

  it("fires the per-caller rate limit independently of the global limit", async () => {
    await app.kernel.config.set(aiTriageRatePolicySchema, AI_TRIAGE_RATE_POLICY_CONFIG_KEY, {
      perCaller: { capacity: 2, refillPerSecond: 0.0001 },
      global: { capacity: 1_000, refillPerSecond: 100 },
    });

    const session = { roles: "patient", user: "triage-rate-caller-test" };
    const first = await trpc(app, "mutation", { text: "symptom text one" }, session);
    expect(first.statusCode).toBe(200);
    const second = await trpc(app, "mutation", { text: "symptom text two" }, session);
    expect(second.statusCode).toBe(200);

    const third = await trpc(app, "mutation", { text: "symptom text three" }, session);
    expect(third.statusCode).toBe(429);
    expect((third.json() as { error: { data: { appCode: string } } }).error.data.appCode).toBe(
      "RATE_LIMITED",
    );

    // A different caller is unaffected by this caller's exhausted bucket.
    const otherCaller = await trpc(
      app,
      "mutation",
      { text: "symptom text from someone else" },
      { roles: "patient", user: "triage-rate-caller-other" },
    );
    expect(otherCaller.statusCode).toBe(200);
  });

  it("fires the global rate limit across distinct callers", async () => {
    await app.kernel.config.set(aiTriageRatePolicySchema, AI_TRIAGE_RATE_POLICY_CONFIG_KEY, {
      perCaller: { capacity: 1_000, refillPerSecond: 100 },
      global: { capacity: 2, refillPerSecond: 0.0001 },
    });

    const first = await trpc(
      app,
      "mutation",
      { text: "global one" },
      { roles: "patient", user: "triage-global-caller-1" },
    );
    expect(first.statusCode).toBe(200);
    const second = await trpc(
      app,
      "mutation",
      { text: "global two" },
      { roles: "patient", user: "triage-global-caller-2" },
    );
    expect(second.statusCode).toBe(200);

    const third = await trpc(
      app,
      "mutation",
      { text: "global three" },
      { roles: "patient", user: "triage-global-caller-3" },
    );
    expect(third.statusCode).toBe(429);
    expect((third.json() as { error: { data: { appCode: string } } }).error.data.appCode).toBe(
      "AI_QUOTA_EXCEEDED",
    );
  });
});
