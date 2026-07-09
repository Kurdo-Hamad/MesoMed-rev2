import type { Env } from "../src/env.js";
import { loadEnv } from "../src/env.js";

/**
 * Env for integration tests: quiet logs, the harness-provided database,
 * and outbox timings turned down so forced-retry scenarios settle in
 * seconds instead of minutes. Values flow through the real loadEnv()
 * so tests exercise the same validation path as production boot.
 */
export function testEnv(databaseUrl: string, extra: NodeJS.ProcessEnv = {}): Env {
  return loadEnv({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    DATABASE_URL: databaseUrl,
    OUTBOX_POLL_INTERVAL_MS: "200",
    OUTBOX_WORKER_POLL_INTERVAL_S: "0.5",
    OUTBOX_RETRY_LIMIT: "1",
    OUTBOX_RETRY_DELAY_S: "0",
    ...extra,
  });
}

/** Poll until `condition` resolves truthy or the timeout elapses. */
export async function waitFor<T>(
  condition: () => Promise<T | undefined | false>,
  { timeoutMs = 15_000, intervalMs = 100 } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await condition();
    if (result) return result;
    if (Date.now() > deadline) throw new Error("waitFor: condition not met within timeout");
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
