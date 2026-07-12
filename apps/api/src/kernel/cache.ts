/**
 * Process-local cache seam (ADR-0012, MM-ARC-002 §1.8). Read paths cache
 * published query results cache-aside behind this interface; the only
 * implementation is an in-process TTL map. A distributed cache (Redis) is
 * deliberately absent until the API runs horizontally — §3.8: the second
 * adapter is built when the second provider is real, never speculatively.
 * The interface is Promise-shaped now so that swap won't ripple through
 * call sites.
 *
 * Not for authoritative data: the config service (kernel/config.ts) stays
 * the only cached source-of-truth reader. Everything through this adapter
 * is a short-TTL convenience copy kept honest by TTLs plus event-driven
 * invalidation registered by the owning module.
 */
export interface CacheAdapter {
  /** Cached value, or undefined on miss/expiry — `undefined` itself is not cacheable. */
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown, ttlMs: number): Promise<void>;
  /** Drop one key. */
  invalidate(key: string): Promise<void>;
  /** Drop every key starting with the prefix (module-owned namespaces). */
  invalidatePrefix(prefix: string): Promise<void>;
}

const DEFAULT_MAX_ENTRIES = 1_000;

export function createInMemoryCache(options?: { maxEntries?: number }): CacheAdapter {
  const maxEntries = options?.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const entries = new Map<string, { value: unknown; expiresAt: number }>();

  return {
    async get<T>(key: string): Promise<T | undefined> {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= Date.now()) {
        entries.delete(key);
        return undefined;
      }
      return entry.value as T;
    },

    async set(key, value, ttlMs) {
      // Delete-then-set refreshes insertion order, so the size cap below
      // always evicts the least-recently-written key.
      entries.delete(key);
      entries.set(key, { value, expiresAt: Date.now() + ttlMs });
      if (entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) entries.delete(oldest);
      }
    },

    async invalidate(key) {
      entries.delete(key);
    },

    async invalidatePrefix(prefix) {
      for (const key of entries.keys()) {
        if (key.startsWith(prefix)) entries.delete(key);
      }
    },
  };
}

/** Cache-aside read: serve the cached value, or load, store, and return it. */
export async function cacheAside<T>(
  cache: CacheAdapter,
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
): Promise<T> {
  const hit = await cache.get<T>(key);
  if (hit !== undefined) return hit;
  const value = await load();
  await cache.set(key, value, ttlMs);
  return value;
}
