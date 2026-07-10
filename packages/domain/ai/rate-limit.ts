/**
 * Pure in-memory token-bucket rate limiter.
 * Ported from the current-codebase pattern (src/lib/rate-limit.ts), kept
 * pure/testable: caller supplies `nowMs` rather than the function reading
 * the clock, and state lives in a module-level Map (single-process only —
 * documented limitation, same as the current app).
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

export function checkRateLimit(
  key: string,
  opts: RateLimitOptions,
  nowMs: number
): boolean {
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
