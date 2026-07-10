import {
  healthResponseSchema,
  readinessResponseSchema,
  type HealthResponse,
  type ReadinessCheck,
  type ReadinessResponse,
} from "@mesomed/contracts/health";
import {
  type Db,
  MIGRATIONS_SCHEMA,
  MIGRATIONS_TABLE,
  expectedMigrationCount,
  sql,
} from "@mesomed/db";

/**
 * Liveness/readiness split (MM-QA-001 F-13): `/health` says the process is
 * up and never consults dependencies; `/ready` says this instance can
 * serve — Postgres reachable, the migrations this build expects applied,
 * and the outbox dispatcher started. Both payloads are built here, once,
 * against the contracts schemas.
 */
export function healthPayload(): HealthResponse {
  return healthResponseSchema.parse({
    status: "ok",
    service: "api",
    timestamp: new Date().toISOString(),
  });
}

export interface ReadinessDeps {
  db: Db;
  dispatcherStarted(): boolean;
}

async function check(name: string, probe: () => Promise<void>): Promise<ReadinessCheck> {
  try {
    await probe();
    return { name, ok: true };
  } catch (error) {
    return { name, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function readinessPayload(deps: ReadinessDeps): Promise<ReadinessResponse> {
  const checks = [
    await check("postgres", async () => {
      await deps.db.execute(sql`select 1`);
    }),
    await check("migrations", async () => {
      const result = await deps.db.execute<{ count: number }>(
        sql`select count(*)::int as count
            from ${sql.identifier(MIGRATIONS_SCHEMA)}.${sql.identifier(MIGRATIONS_TABLE)}`,
      );
      const applied = result.rows[0]?.count ?? 0;
      if (applied < expectedMigrationCount) {
        throw new Error(`${applied} of ${expectedMigrationCount} expected migrations applied`);
      }
    }),
    await check("dispatcher", async () => {
      if (!deps.dispatcherStarted()) throw new Error("outbox dispatcher not started");
    }),
  ];
  return readinessResponseSchema.parse({
    status: checks.every((entry) => entry.ok) ? "ready" : "unavailable",
    service: "api",
    timestamp: new Date().toISOString(),
    checks,
  });
}
