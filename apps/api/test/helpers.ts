import type { Env } from "../src/env.js";
import { loadEnv } from "../src/env.js";

/**
 * Env for integration tests: quiet logs, the harness-provided database,
 * and outbox timings turned down so forced-retry scenarios settle in
 * seconds instead of minutes. Values flow through the real loadEnv()
 * so tests exercise the same validation path as production boot.
 *
 * NOTIFICATION_POLL_INTERVAL_MS is pushed out to an hour, the opposite
 * direction from the outbox tuning above: `buildServer` unconditionally
 * starts its own background NotificationSender (app.ts) against the real
 * db and its own internally-wired mock channels. No test relies on that
 * auto-poller — every test that exercises delivery (communication/
 * dispatch.test.ts) builds and drives its own instrumented
 * NotificationSender instance against the same row instead. Left at the
 * production default (5s), the two raced for the same due row; under an
 * unloaded run the manual pump() call (issued within milliseconds of the
 * row appearing) always won, but under full-suite contention the event
 * loop could stall long enough for the background poller's tick to claim
 * the row first — via a different db wrapper and different mock
 * channels than the test held references to — silently marking it `sent`
 * before the test's own claimBatch() query ran. That produced ADR-0011
 * F-11's occasional `sentWriteAttempts === 0` failure (the row was never
 * seen as `pending` by the test's own sender at all, not a retry-timing
 * miss). Fixed at the root: the auto-poller now can't tick within any
 * single test file's lifetime, so only the test's own explicit pump()
 * calls ever touch a row.
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
    NOTIFICATION_POLL_INTERVAL_MS: "3600000",
    BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0000",
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
