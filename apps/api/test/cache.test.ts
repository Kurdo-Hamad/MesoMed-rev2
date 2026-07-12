import { afterEach, describe, expect, it, vi } from "vitest";
import { cacheAside, createInMemoryCache } from "../src/kernel/cache.js";

/**
 * Kernel cache seam (ADR-0012): TTL expiry, explicit and prefix
 * invalidation, the size cap, and the cache-aside contract. Event-driven
 * invalidation through the real dispatcher is proven in
 * test/directory/cache.test.ts.
 */
describe("in-memory cache adapter", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("serves a set value until its TTL elapses, then misses", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const cache = createInMemoryCache();
    await cache.set("k", { n: 1 }, 1_000);
    expect(await cache.get("k")).toEqual({ n: 1 });
    vi.advanceTimersByTime(999);
    expect(await cache.get("k")).toEqual({ n: 1 });
    vi.advanceTimersByTime(1);
    expect(await cache.get("k")).toBeUndefined();
  });

  it("invalidate drops exactly the named key", async () => {
    const cache = createInMemoryCache();
    await cache.set("a", 1, 60_000);
    await cache.set("b", 2, 60_000);
    await cache.invalidate("a");
    expect(await cache.get("a")).toBeUndefined();
    expect(await cache.get("b")).toBe(2);
  });

  it("invalidatePrefix drops every key under the namespace and nothing else", async () => {
    const cache = createInMemoryCache();
    await cache.set("directory:homepage:en", 1, 60_000);
    await cache.set("directory:taxonomy:cities", 2, 60_000);
    await cache.set("billing:rates", 3, 60_000);
    await cache.invalidatePrefix("directory:");
    expect(await cache.get("directory:homepage:en")).toBeUndefined();
    expect(await cache.get("directory:taxonomy:cities")).toBeUndefined();
    expect(await cache.get("billing:rates")).toBe(3);
  });

  it("evicts the least-recently-written key once past maxEntries", async () => {
    const cache = createInMemoryCache({ maxEntries: 2 });
    await cache.set("first", 1, 60_000);
    await cache.set("second", 2, 60_000);
    // Rewriting "first" refreshes its insertion order, so "second" is now
    // the stalest write and the cap evicts it.
    await cache.set("first", 10, 60_000);
    await cache.set("third", 3, 60_000);
    expect(await cache.get("second")).toBeUndefined();
    expect(await cache.get("first")).toBe(10);
    expect(await cache.get("third")).toBe(3);
  });

  it("cacheAside loads once and serves the cached value afterwards", async () => {
    const cache = createInMemoryCache();
    const load = vi.fn(async () => ({ slots: ["x"] }));
    const first = await cacheAside(cache, "k", 60_000, load);
    const second = await cacheAside(cache, "k", 60_000, load);
    expect(first).toEqual({ slots: ["x"] });
    expect(second).toEqual({ slots: ["x"] });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("cacheAside reloads after the entry is invalidated", async () => {
    const cache = createInMemoryCache();
    let version = 0;
    const load = vi.fn(async () => ({ version: ++version }));
    expect(await cacheAside(cache, "k", 60_000, load)).toEqual({ version: 1 });
    await cache.invalidate("k");
    expect(await cacheAside(cache, "k", 60_000, load)).toEqual({ version: 2 });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("never caches undefined: an undefined load result is re-attempted", async () => {
    const cache = createInMemoryCache();
    const load = vi.fn(async (): Promise<string | undefined> => undefined);
    expect(await cacheAside(cache, "k", 60_000, load)).toBeUndefined();
    expect(await cacheAside(cache, "k", 60_000, load)).toBeUndefined();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
