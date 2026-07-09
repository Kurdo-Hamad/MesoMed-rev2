import { healthResponseSchema } from "@mesomed/contracts/health";
import { healthPayload } from "../kernel/health.js";
import { publicProcedure, router } from "./trpc.js";

const healthRouter = router({
  check: publicProcedure.output(healthResponseSchema).query(() => healthPayload()),
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
