import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import { healthResponseSchema } from "@mesomed/contracts/health";
import { createContext } from "../src/trpc/context.js";
import { appRouter } from "../src/trpc/router.js";

describe("health", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    app.get("/health", async () =>
      healthResponseSchema.parse({
        status: "ok",
        service: "api",
        timestamp: new Date().toISOString(),
      }),
    );
    await app.register(fastifyTRPCPlugin, {
      prefix: "/trpc",
      trpcOptions: { router: appRouter, createContext },
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /health returns ok", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ok");
  });

  it("tRPC health.check returns ok", async () => {
    const res = await app.inject({ method: "GET", url: "/trpc/health.check" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.result.data.status).toBe("ok");
  });
});
