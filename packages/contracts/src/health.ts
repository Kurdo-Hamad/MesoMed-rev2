import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.string(),
  timestamp: z.string(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

/**
 * Readiness is distinct from liveness (MM-QA-001 F-13): /health answers
 * "is the process up", /ready answers "can this instance serve" — Postgres
 * reachable, migrations applied, job dispatcher started. Orchestrators
 * gate traffic on readiness only.
 */
export const readinessCheckSchema = z.object({
  name: z.string(),
  ok: z.boolean(),
  error: z.string().optional(),
});

export const readinessResponseSchema = z.object({
  status: z.enum(["ready", "unavailable"]),
  service: z.string(),
  timestamp: z.string(),
  checks: z.array(readinessCheckSchema),
});

export type ReadinessCheck = z.infer<typeof readinessCheckSchema>;
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
