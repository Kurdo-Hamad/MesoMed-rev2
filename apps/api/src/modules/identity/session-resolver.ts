/**
 * Maps a Better Auth session to the kernel Session (userId + roles).
 * Roles come from the module-owned `user_roles` table — one indexed query
 * per authenticated request (§3.6 layer a).
 */
import type { FastifyRequest } from "fastify";
import { fromNodeHeaders } from "better-auth/node";

import { eq, userRoles, type Db } from "@mesomed/db";
import type { Session, SessionResolver } from "../../kernel/context.js";
import type { IdentityAuth } from "./auth.js";

export function createIdentitySessionResolver(deps: {
  auth: IdentityAuth;
  db: Db;
}): SessionResolver {
  return async (req: FastifyRequest): Promise<Session | null> => {
    const session = await deps.auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (!session?.user) return null;

    const rows = await deps.db
      .select({ role: userRoles.role })
      .from(userRoles)
      .where(eq(userRoles.userId, session.user.id));

    return { userId: session.user.id, roles: rows.map((row) => row.role) };
  };
}
