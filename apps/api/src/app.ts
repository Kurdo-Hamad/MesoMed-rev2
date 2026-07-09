import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import * as Sentry from "@sentry/node";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import type { Env } from "./env.js";
import { healthPayload } from "./kernel/health.js";
import { createContext } from "./trpc/context.js";
import { appRouter } from "./trpc/router.js";

/**
 * Composition root (MM-PLAN-001 §3.8): constructs the real application —
 * no listening, no telemetry init, no process wiring — so tests exercise
 * the deployable app rather than a hand-wired copy (MM-QA-001 F-05).
 * Phase 1 kernel services and platform adapters are injected here.
 */
export async function buildServer(env: Env): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport: env.NODE_ENV === "development" ? { target: "pino-pretty" } : undefined,
    },
  });

  Sentry.setupFastifyErrorHandler(app);

  // Explicit allowlist, never reflection: this API carries Better Auth
  // cookie sessions from Phase 2, and `credentials: true` combined with a
  // reflected origin would be an authenticated-CSRF surface (ADR-0002,
  // MM-QA-001 F-04).
  await app.register(cors, {
    origin: env.CORS_ORIGINS,
    credentials: true,
  });

  app.get("/health", async () => healthPayload());

  await app.register(fastifyTRPCPlugin, {
    prefix: "/trpc",
    trpcOptions: { router: appRouter, createContext },
  });

  return app;
}
