import { healthResponseSchema } from "@mesomed/contracts/health";
import { healthPayload } from "../kernel/health.js";
import { publicProcedure, router } from "../kernel/trpc.js";
import { systemRouter } from "./system.js";

const healthRouter = router({
  check: publicProcedure.output(healthResponseSchema).query(() => healthPayload()),
});

/**
 * Root tRPC router. Business modules mount their routers here starting
 * Phase 2 (MM-PLAN-001 §2 — one router per module); it lives outside the
 * kernel because it will depend on module routers, which the kernel must
 * never do.
 */
export const appRouter = router({
  health: healthRouter,
  system: systemRouter,
});

export type AppRouter = typeof appRouter;
