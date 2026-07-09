import { z } from "zod";

/**
 * Generic outbox event envelope per MM-PLAN-001 §3.3: every event contract
 * is `{ name, version, payload }`. Additive changes only — a breaking change
 * is a new version, with old handlers kept until drained. Concrete business
 * event schemas are added module-by-module starting Phase 1.
 */
export function eventEnvelope<PayloadSchema extends z.ZodTypeAny>(
  name: string,
  version: number,
  payloadSchema: PayloadSchema,
) {
  return z.object({
    name: z.literal(name),
    version: z.literal(version),
    payload: payloadSchema,
  });
}
