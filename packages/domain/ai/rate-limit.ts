/**
 * Pure in-memory token-bucket rate limiter.
 * Ported from the current-codebase pattern (src/lib/rate-limit.ts), kept
 * pure/testable: caller supplies `nowMs` rather than the function reading
 * the clock, and state lives in a module-level Map.
 *
 * Two documented limitations (ADR-0011 F-10), not fixed here because fixing
 * them means a shared store (Redis is explicitly deferred, MM-PLAN-001 §8):
 *
 * - **Single-process only.** With N API instances behind a load balancer,
 *   each holds its own independent Map — a per-caller or global cap is
 *   effectively multiplied by N (every instance enforces the full
 *   configured capacity independently). Size configured policies (e.g.
 *   `ai.triage_rate_policy`) with this multiplier in mind, or accept the
 *   wider effective ceiling until a shared store lands.
 * - **Unbounded key growth**, mitigated below by periodic eviction of
 *   buckets untouched long enough that they're indistinguishable from a
 *   fresh one (idle longer than any realistic policy window refills them to
 *   full capacity regardless) — this bounds memory, it does not change
 *   rate-limiting behavior for any key still in active use.
 */

export interface RateLimitOptions {
  capacity: number;
  refillPerSecond: number;
}

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, Bucket>();

/**
 * A bucket untouched for this long is safe to evict unconditionally: every
 * policy in this system windows in seconds-to-an-hour (see
 * `DEFAULT_SEND_RATE_POLICY`, `DEFAULT_OTP_SEND_POLICY`), so an idle bucket
 * this stale has long since refilled to full capacity — dropping it and
 * recreating fresh on the next call is behaviorally identical.
 */
const STALE_BUCKET_MS = 2 * 60 * 60 * 1000;
/** Amortizes the eviction sweep's O(n) cost across calls rather than paying it every time. */
const SWEEP_INTERVAL_CALLS = 1_000;
let callsSinceSweep = 0;

function evictStaleBuckets(nowMs: number): void {
  for (const [key, bucket] of buckets) {
    if (nowMs - bucket.lastRefill > STALE_BUCKET_MS) buckets.delete(key);
  }
}

export function checkRateLimit(key: string, opts: RateLimitOptions, nowMs: number): boolean {
  callsSinceSweep++;
  if (callsSinceSweep >= SWEEP_INTERVAL_CALLS) {
    callsSinceSweep = 0;
    evictStaleBuckets(nowMs);
  }

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: opts.capacity, lastRefill: nowMs };
    buckets.set(key, bucket);
  } else {
    const elapsedSeconds = Math.max(0, (nowMs - bucket.lastRefill) / 1000);
    const refill = elapsedSeconds * opts.refillPerSecond;
    bucket.tokens = Math.min(opts.capacity, bucket.tokens + refill);
    bucket.lastRefill = nowMs;
  }

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return true;
  }
  return false;
}

/** Test-only introspection of the bucket map's size — not part of the public rate-limiting contract. */
export function _debugBucketCount(): number {
  return buckets.size;
}
