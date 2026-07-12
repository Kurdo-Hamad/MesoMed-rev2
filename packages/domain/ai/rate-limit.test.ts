import { describe, expect, it } from "vitest";

import { _debugBucketCount, checkRateLimit } from "./rate-limit.js";

describe("checkRateLimit", () => {
  it("allows up to capacity, then refuses", () => {
    const opts = { capacity: 2, refillPerSecond: 0 };
    const key = `test-basic-${Math.random()}`;
    expect(checkRateLimit(key, opts, 0)).toBe(true);
    expect(checkRateLimit(key, opts, 0)).toBe(true);
    expect(checkRateLimit(key, opts, 0)).toBe(false);
  });

  it("refills over time at the configured rate", () => {
    const opts = { capacity: 1, refillPerSecond: 1 };
    const key = `test-refill-${Math.random()}`;
    expect(checkRateLimit(key, opts, 0)).toBe(true);
    expect(checkRateLimit(key, opts, 500)).toBe(false); // 0.5s elapsed, not enough
    expect(checkRateLimit(key, opts, 1_000)).toBe(true); // 1s elapsed, refilled
  });

  it("tracks distinct keys independently", () => {
    const opts = { capacity: 1, refillPerSecond: 0 };
    const keyA = `test-distinct-a-${Math.random()}`;
    const keyB = `test-distinct-b-${Math.random()}`;
    expect(checkRateLimit(keyA, opts, 0)).toBe(true);
    expect(checkRateLimit(keyA, opts, 0)).toBe(false);
    expect(checkRateLimit(keyB, opts, 0)).toBe(true);
  });

  /**
   * ADR-0011 F-10: an earlier version never evicted anything — every
   * distinct key (e.g. every IP address hitting the public AI triage
   * endpoint) accumulated in the module-level Map forever. Checking a
   * refilled bucket's boolean return can't distinguish "evicted and
   * recreated fresh" from "never evicted but naturally refilled over 3
   * hours" — both look identical from `checkRateLimit`'s return value
   * alone. So this asserts the actual map size shrinks: if eviction never
   * ran, the map could only grow (nothing is ever removed on its own).
   */
  it("evicts buckets idle past the staleness window, bounding the map's growth", () => {
    const opts = { capacity: 5, refillPerSecond: 1 };
    const staleTime = 10_000_000 + Math.random() * 1_000; // an isolated timeline
    const laterTime = staleTime + 3 * 60 * 60 * 1000; // 3h later — past the 2h staleness window

    const staleKeys = Array.from({ length: 50 }, (_, i) => `test-evict-stale-${i}-${Math.random()}`);
    for (const key of staleKeys) checkRateLimit(key, opts, staleTime);
    const peakCount = _debugBucketCount();

    // Guaranteed to cross the periodic sweep's call threshold at least
    // once, regardless of any leftover call-count offset left by the other
    // tests in this file sharing the same module-level state.
    for (let i = 0; i < 1_100; i++) {
      checkRateLimit(`test-evict-trigger-${i}-${Math.random()}`, opts, laterTime);
    }

    expect(_debugBucketCount()).toBeLessThan(peakCount + 1_100);

    // The stale key starts completely fresh (full capacity available) —
    // proof its bucket was actually removed, not merely refilled.
    expect(checkRateLimit(staleKeys[0]!, opts, laterTime)).toBe(true);
  });
});
