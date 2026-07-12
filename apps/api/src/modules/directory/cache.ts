/**
 * Directory read cache (ADR-0012): key builders and TTLs for the homepage
 * feed and taxonomy lists, plus event-driven invalidation. Every directory
 * mutation already emits one of the module's five domain events — admin
 * upserts directly, and the handlers mirroring identity approval and
 * billing subscription/tier state re-emit `directory.facility_updated.v1`
 * — so busting the module prefix on those names covers every write path
 * with no new event contracts. Browse and detail reads stay uncached: their
 * filter/cursor key space is unbounded and their queries are cheap
 * indexed lookups.
 */
import type { Locale } from "@mesomed/contracts/i18n";
import type { CacheAdapter } from "../../kernel/cache.js";
import type { HandlerRegistry } from "../../kernel/events.js";
import type { HomepageFeedInput } from "./queries/homepage-feed.js";

export const DIRECTORY_CACHE_PREFIX = "directory:";

/**
 * Short TTLs are the safety net for any write path that ever bypasses the
 * event bus; event invalidation is the primary freshness mechanism.
 */
export const HOMEPAGE_FEED_TTL_MS = 30_000;
export const TAXONOMY_TTL_MS = 60_000;

/** Locale is part of the key: the featured fill orders by localized name. */
export function homepageFeedCacheKey(locale: Locale, input: HomepageFeedInput): string {
  return `${DIRECTORY_CACHE_PREFIX}homepage:${locale}:${input.citySlug ?? "*"}:${input.limit}`;
}

export function taxonomyCacheKey(list: string): string {
  return `${DIRECTORY_CACHE_PREFIX}taxonomy:${list}`;
}

/**
 * Idempotency identity in `processed_events` — stable across deploys
 * (kernel/events.ts): treat like a migration name.
 */
export const DIRECTORY_CACHE_INVALIDATION_HANDLER = "directory-cache-invalidate";

export function registerDirectoryCacheInvalidation(
  events: HandlerRegistry,
  cache: CacheAdapter,
): void {
  const invalidate = () => cache.invalidatePrefix(DIRECTORY_CACHE_PREFIX);
  events.on("directory.facility_created.v1", DIRECTORY_CACHE_INVALIDATION_HANDLER, invalidate);
  events.on("directory.facility_updated.v1", DIRECTORY_CACHE_INVALIDATION_HANDLER, invalidate);
  events.on(
    "directory.doctor_profile_created.v1",
    DIRECTORY_CACHE_INVALIDATION_HANDLER,
    invalidate,
  );
  events.on(
    "directory.doctor_profile_updated.v1",
    DIRECTORY_CACHE_INVALIDATION_HANDLER,
    invalidate,
  );
  events.on("directory.taxonomy_changed.v1", DIRECTORY_CACHE_INVALIDATION_HANDLER, invalidate);
}
