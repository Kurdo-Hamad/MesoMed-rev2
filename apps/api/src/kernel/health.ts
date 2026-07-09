import { healthResponseSchema, type HealthResponse } from "@mesomed/contracts/health";

/**
 * Single source for the health payload, consumed by both the REST route
 * (container healthcheck) and the tRPC procedure. Phase 1 splits this into
 * liveness vs readiness once the API has real dependencies (MM-QA-001 F-13).
 */
export function healthPayload(): HealthResponse {
  return healthResponseSchema.parse({
    status: "ok",
    service: "api",
    timestamp: new Date().toISOString(),
  });
}
