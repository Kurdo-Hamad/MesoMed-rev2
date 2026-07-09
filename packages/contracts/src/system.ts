import { z } from "zod";
import { ROLES } from "./roles.js";

/** I/O contracts for the kernel-level `system` tRPC router. */

export const whoamiResponseSchema = z.object({
  userId: z.string().nullable(),
  roles: z.array(z.enum(ROLES)),
  locale: z.string(),
  country: z.string(),
});

export type WhoamiResponse = z.infer<typeof whoamiResponseSchema>;

/** Outbox depth by status — the ops signal MM-PLAN-001 §5 Phase 10 alerts on. */
export const outboxStatsResponseSchema = z.object({
  pending: z.number().int().nonnegative(),
  published: z.number().int().nonnegative(),
  processed: z.number().int().nonnegative(),
  dead: z.number().int().nonnegative(),
});

export type OutboxStatsResponse = z.infer<typeof outboxStatsResponseSchema>;
