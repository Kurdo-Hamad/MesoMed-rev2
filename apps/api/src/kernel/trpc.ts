import { initTRPC } from "@trpc/server";
import { assertAppVersionSupported } from "./app-version.js";
import type { Context } from "./context.js";
import { AppError, appErrorToTRPCError, toAppCode } from "./errors.js";

/**
 * Typed error codes per MM-PLAN-001 §3.11. The canonical tRPC code in
 * `data.code` is preserved for standard client tooling; the application
 * code rides alongside as `data.appCode`. Clients switch on codes, never
 * on message strings (MM-QA-001 F-07 — the previous formatter clobbered
 * `data.code`, breaking both namespaces).
 */
const t = initTRPC.context<Context>().create({
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        appCode: toAppCode(error),
      },
    };
  },
});

/**
 * Handlers (and downstream middleware such as the authz guard) throw plain
 * AppErrors; this middleware re-wraps them as properly-mapped TRPCErrors so
 * HTTP statuses survive. (tRPC wraps unknown thrown values as
 * INTERNAL_SERVER_ERROR with `cause` set — without this, an
 * AppError("NOT_FOUND") would answer 500.)
 */
const appErrorMiddleware = t.middleware(async ({ next }) => {
  const result = await next();
  if (!result.ok && result.error.cause instanceof AppError) {
    throw appErrorToTRPCError(result.error.cause);
  }
  return result;
});

/**
 * Mobile compatibility gate (MM-ARC-002 §1.3): rejects requests whose
 * x-app-version is below the configured minimum with the typed
 * UPGRADE_REQUIRED. Runs on every procedure, before authz — an outdated
 * client is told to upgrade regardless of what it asked for.
 */
const appVersionMiddleware = t.middleware(async ({ ctx, next }) => {
  await assertAppVersionSupported(ctx);
  return next();
});

export const middleware = t.middleware;
export const router = t.router;
export const publicProcedure = t.procedure.use(appErrorMiddleware).use(appVersionMiddleware);
