import { ErrorCode } from "@mesomed/contracts/errors";
import type { Role } from "@mesomed/contracts/roles";
import { AppError } from "./errors.js";
import { middleware, publicProcedure } from "./trpc.js";

/**
 * Kernel authz middleware — layer (a) of the two-layer authorization model
 * (MM-PLAN-001 §3.6): a per-procedure role guard. Layer (b), resource
 * ownership, is checked inside each command/query handler against the same
 * session. Denials are typed AppErrors so clients get UNAUTHORIZED /
 * FORBIDDEN codes, never parsed message strings (§3.11).
 */
export function requireRole(...allowed: readonly Role[]) {
  return middleware(async ({ ctx, next }) => {
    if (!ctx.session) {
      throw new AppError(ErrorCode.UNAUTHORIZED, "Authentication required");
    }
    if (!ctx.session.roles.some((role) => allowed.includes(role))) {
      throw new AppError(ErrorCode.FORBIDDEN, "Insufficient role for this procedure");
    }
    return next({ ctx: { ...ctx, session: ctx.session } });
  });
}

/** A procedure only the given roles may call. */
export function roleProcedure(...allowed: readonly Role[]) {
  return publicProcedure.use(requireRole(...allowed));
}

/**
 * A procedure any authenticated user may call, role or not — e.g. a
 * freshly registered account claiming its profile before any role exists.
 */
export const authenticatedProcedure = publicProcedure.use(
  middleware(async ({ ctx, next }) => {
    if (!ctx.session) {
      throw new AppError(ErrorCode.UNAUTHORIZED, "Authentication required");
    }
    return next({ ctx: { ...ctx, session: ctx.session } });
  }),
);
