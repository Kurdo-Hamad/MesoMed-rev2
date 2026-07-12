# ADR-0012 — Phase 8 Slice 0: Caching Seam

**Status:** Accepted
**Phase:** 8 (Web App — required at phase start per MM-ARC-002 §1.8, restated
in the Phase 8 kickoff instruction, now committed at docs/governance/MM-ARC-002-Strategic-Architecture-Package.md).
**Builds on:** ADR-0003 (kernel, config service, idempotent handler
registry), ADR-0005 (directory read models, homepage feed), ADR-0008/0009
(billing→directory event mirroring).

## Decision: three layers, nothing speculative

1. **HTTP/CDN caching** — public Next.js pages and cacheable tRPC GET
   queries carry `Cache-Control: s-maxage` + `stale-while-revalidate`.
   This layer is configuration on the web app and its host, not API code;
   it lands with the web-foundation slice and its values are recorded
   there. Only anonymous, non-personalized responses are eligible —
   anything session-scoped is `private`/uncached.

2. **In-process TTL cache behind a kernel `CacheAdapter`**
   (`apps/api/src/kernel/cache.ts`): `get/set/invalidate/invalidatePrefix`,
   implemented by a `Map` with per-entry TTL and a size cap (least-recently-
   written eviction at 1 000 entries). The interface is Promise-shaped so a
   Redis-backed implementation can replace it **when the API runs
   horizontally and not before** (§3.8: the second adapter is built when
   the second provider is real). No Redis is built, configured, or
   dependency-added in this phase.

3. **Authoritative data stays where it was**: the config service
   (`kernel/config.ts`) remains the only cached source-of-truth reader,
   with its own TTL + write-through invalidation. Everything served
   through the `CacheAdapter` is a short-TTL convenience copy of
   published read models — cache-aside, never write-through, never a
   source of truth.

## What is wired through it (and what is not)

- `directory.homepageFeed` — 30 s TTL, key
  `directory:homepage:{locale}:{citySlug|*}:{limit}`. Locale is part of the
  key because the featured fill orders by localized name.
- `directory.list{Countries,Cities,Categories,Specialties,Symptoms,Procedures}`
  — 60 s TTL, key `directory:taxonomy:{list}`. Payloads are
  locale-independent (localized text is packed per row).
- **Not cached:** browse/detail reads (unbounded filter/cursor key space
  over cheap indexed queries), every authenticated or role-scoped read,
  and all of search (its read model is already denormalized).

## Invalidation rides existing events

Every directory write path already ends in one of the module's five domain
events — admin upserts emit them directly; the handlers mirroring identity
approval and billing subscription/tier state re-emit
`directory.facility_updated.v1`. `registerDirectoryCacheInvalidation`
(`modules/directory/cache.ts`) subscribes handler
`directory-cache-invalidate` to all five names and busts the `directory:`
prefix. No new event contracts; the pinned directory event set is
unchanged. Short TTLs are the safety net for any path that ever bypasses
the bus (proven the only stale window in the integration test by writing
to the tables directly).

Cache scope is per-process and the dispatcher runs in the same process, so
event-driven invalidation is complete under the current single-instance
deployment. Horizontal scale-out is the trigger to revisit (same trigger
as the Redis adapter), recorded here deliberately.

## Consequences / notes

- `KernelRequestServices` gains `cache`; tRPC context and `app.kernel`
  expose it. Modules own their key namespaces (`directory:` here); the
  kernel owns only the mechanism.
- Trade-off accepted: prefix-wide busting on any directory event is
  coarser than per-key invalidation, but directory writes are rare
  (admin- and event-driven), and correctness beats hit rate at this
  traffic level.
- Tests: `test/cache.test.ts` (TTL, eviction cap, prefix invalidation,
  cache-aside contract, undefined-not-cacheable) and
  `test/directory/cache.test.ts` (staleness proven via direct table
  writes, per-locale keying, event-driven invalidation through the real
  dispatcher, taxonomy-list busting).
