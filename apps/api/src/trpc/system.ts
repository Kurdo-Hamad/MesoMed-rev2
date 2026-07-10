import { sql } from "drizzle-orm";
import { outboxStatsResponseSchema, whoamiResponseSchema } from "@mesomed/contracts/system";
import { domainEvents } from "@mesomed/db";
import { roleProcedure } from "../kernel/authz.js";
import { publicProcedure, router } from "../kernel/trpc.js";

/**
 * Kernel-level system procedures. `whoami` echoes the request-scoped
 * context so clients can verify session/locale/country resolution;
 * `outboxStats` is the admin ops view of outbox depth by status — the
 * signal Phase 10 dashboards alert on — and doubles as the in-app consumer
 * of the kernel role guard.
 */
export const systemRouter = router({
  whoami: publicProcedure.output(whoamiResponseSchema).query(({ ctx }) => ({
    userId: ctx.session?.userId ?? null,
    roles: [...(ctx.session?.roles ?? [])],
    locale: ctx.locale,
    country: ctx.country,
  })),

  outboxStats: roleProcedure("admin")
    .output(outboxStatsResponseSchema)
    .query(async ({ ctx }) => {
      const rows = await ctx.db
        .select({ status: domainEvents.status, count: sql<number>`count(*)::int` })
        .from(domainEvents)
        .groupBy(domainEvents.status);
      const stats = { pending: 0, published: 0, processed: 0, dead: 0 };
      for (const row of rows) stats[row.status] = row.count;
      return stats;
    }),
});
