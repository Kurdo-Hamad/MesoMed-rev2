import { healthResponseSchema } from "@mesomed/contracts/health";
import { publicProcedure, router } from "./trpc.js";

const healthRouter = router({
  check: publicProcedure.output(healthResponseSchema).query(() => ({
    status: "ok" as const,
    service: "api",
    timestamp: new Date().toISOString(),
  })),
});

/**
 * Root tRPC router. Business modules mount their routers here starting
 * Phase 1+ (MM-PLAN-001 §2 — one router per module). Phase 0 exposes only
 * the health procedure.
 */
export const appRouter = router({
  health: healthRouter,
});

export type AppRouter = typeof appRouter;
