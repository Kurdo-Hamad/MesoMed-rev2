import { healthResponseSchema } from "@mesomed/contracts/health";
import { healthPayload } from "../kernel/health.js";
import { publicProcedure, router } from "../kernel/trpc.js";
import { createDirectoryRouter } from "../modules/directory/router.js";
import { createIdentityRouter } from "../modules/identity/router.js";
import type { IdentityModule } from "../modules/identity/index.js";
import { createSearchRouter } from "../modules/search/router.js";
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
export function createAppRouter(identity: IdentityModule) {
  return router({
    health: healthRouter,
    system: systemRouter,
    identity: createIdentityRouter(identity.auth),
    directory: createDirectoryRouter(),
    search: createSearchRouter(),
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;
