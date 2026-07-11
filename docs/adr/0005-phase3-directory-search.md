# ADR-0005 — Phase 3: Directory + Taxonomy + Search

**Status:** Accepted
**Phase:** 3 (MM-PLAN-001 §5) — directory module, taxonomy, config-driven
country gating, search module, seed pipeline, 200k perf validation.
**Builds on:** ADR-0003 (kernel/outbox), ADR-0004 (identity; carry-forward
constraints honored: drizzle-orm operators imported from `@mesomed/db` only,
Better Auth Origin note unaffected).

## Decisions

### 1. Country gating is a config row, not a table column

`countries` (directory-owned) holds display taxonomy only — trilingual
names, ISO code, sort order. Whether a country is live is a single
`config_entries` row (`directory.country_gating`, ISO code → `active |
coming_soon`) validated by `packages/config`'s `countryGatingSchema` and
read through the Phase 1 config service. One authority, so table and config
cannot drift; adding/flipping a country is pure data (§3.9 — proven by
`test/directory/gating.test.ts`, which brings a country unknown to any code
live via `directory.setCountryGating` alone). Unlisted or missing config
fails **closed** (`coming_soon`); any other config failure propagates —
an outage must not masquerade as "coming soon". The guard
(`kernel/gating.ts::assertCountryActive`) answers the typed
`COUNTRY_COMING_SOON` code (→ 412) on every public read surface, search
included.

### 2. Public visibility is a denormalized column with one recompute path

The Phase 2 gate ("public ⇔ provider approved") is materialized as
`publicly_visible` on `doctor_profiles`/`facilities`, computed as
`providers.approved AND active` exclusively inside the directory
(commands + its `identity.provider_status_changed.v1` subscriber, which
re-emits `directory.*_updated.v1` so read models follow). Queries filter on
the single column — the partial landing indexes key on it, and Phase 6
extends visibility by adding billing state to the one recompute function
(`shared.ts::recomputeProviderVisibility`) without touching any query.
`providers.identity_profile_id` is a plain uuid (no cross-module FK);
approval state is read via the identity module's published query
`isProviderProfileApproved`.

### 3. "Published query functions" = the module's `queries/` folder (lint-enforced)

The Phase 1 boundaries rule banned _all_ cross-module value imports, which
contradicted §3.1's sanctioned read path. The rule now classifies
`src/modules/*/queries/**` as `module-query`: importable by other modules,
while a published query itself still cannot reach into another module's
internals (captured-value negation). Meta-tests added for both directions
(convention #14). `mode: "file"` is soft-deprecated in
eslint-plugin-boundaries v7 but currently the only way to classify files
under a captured folder — revisit at the plugin's v8.

### 4. Search is a separate module fed only by event payloads

`search_documents` (search-owned) carries everything its queries serve —
trilingual names, slug, category/specialty key, city slug, visibility,
rank — sourced entirely from `directory.*` event payloads (the events carry
full snapshots for this reason). FTS uses a generated `tsvector` with the
`'simple'` config (no single language config fits en/ar/ckb; pg_trgm GIN
indexes on all three name columns supply substring/typo matching — the same
conclusion as the old codebase's 0012 migration). Indexing handlers are
keyed upserts on the dispatcher's idempotency-claimed transaction:
redelivery converges (proven), and a poisoned event dead-letters without
touching the read model (proven).

### 5. Taxonomies are rows, promotions lost their enum

Categories, section types, the category↔section-type junction, symptom→
specialty weights: all data (§3.9). `homepage_promotions.category` (a
Postgres enum in the old schema) became `(entity_type, category_slug)` text
columns — a new promotable category is an INSERT, not an enum migration.
`entity_ref` stays a polymorphic slug; unresolvable promotions are silently
dropped by the homepage resolver (the featured-slot resolver the old app
stubbed): curated promotions first, then live effective-tier-1 fill,
expired tiers demoted at read time via the ported `effectiveTierRank`.

### 6. Billing tables are NOT ported; facilities carry `tier_rank` only

`listing_tiers`/`tier_prices`/`tier_payments` are Phase 6. The stable
landing sort needs only the denormalized `tier_rank` (+ `tier_expires_at`),
admin-set until billing events drive it. Gallery caps reuse the ported pure
`galleryCapForRank`.

### 7. Seed pipeline goes through the real commands

The salvaged 4-script pipeline (1,466 lines) became
`apps/api/scripts/seed/` (data ported verbatim, runner rewritten): every
row is written by the module's command functions so the same outbox events
production emits populate the search read model via the real dispatcher,
then the runner drains the outbox before exiting. Deterministic UUIDs are
pinned through a seed-only `id` option on the command functions — never
part of the tRPC contracts. Scheduling/appointments/clinical/billing
portions of the old seed are deliberately not ported (later phases).
Re-run convergence is CI-tested; the seed suite is the slowest file
(~4 min) because a full re-seed re-emits and re-drains every event.

### 8. Doctors browse keyset

Doctors have no tier; browse reuses the ported opaque cursor with the rank
component pinned to 0 over the (name_locale, id) sort, one partial index per
locale. "Pending" demo doctors are seeded `active: false` until a real
identity approval flow owns them.

## Gate evidence (2026-07-11)

- **Perf, 200k synthetic facilities through real tRPC procedures**
  (embedded PG16, WSL2): browse keyset p50 4.8ms / **p95 6.7ms** / p99
  8.8ms; trigram search p50 13.3ms / **p95 20.2ms** / p99 307.6ms — budget
  p95 < 100ms PASS. EXPLAIN: keyset = pure Index Scan on
  `facilities_landing_en_idx` (no Sort node), search = BitmapOr over the
  three trgm GIN indexes + tsvector GIN. Harness:
  `pnpm --filter @mesomed/api perf` (refuses hosted DBs; defaults to a
  disposable embedded instance).
- **Tests:** full API suite 20 files / 166 tests green locally (embedded
  PG16), including: trilingual round-trip on browse/detail/feed/search;
  cursor walk with no dupes/gaps; media capped by effective tier; country
  gating flip via config row only; admin denial matrix (14 commands ×
  anonymous/patient/doctor/secretary); invariant violations (unknown
  specialty/city/section type); subscriber idempotency under redelivery;
  poisoned event dead-letters with read model intact; end-to-end
  visibility flip on `identity.provider_status_changed.v1`; seed
  determinism + idempotence. Boundaries meta-tests extended (8 green).

## Deviations / notes

- The directory module's `queries/` files import module-internal helpers
  (`shared.ts`); allowed by the same-module capture exception in the new
  lint policy.
- `packText`/`packOptionalText` live in `@mesomed/contracts/directory`
  (pure wire-shape helpers next to `localizedTextSchema`);
  `assertCountryActive` lives in the kernel — both shared by directory and
  search without cross-module imports.
- No new i18n catalog keys: every user-facing directory string is
  DB-resident trilingual data; API errors are typed codes (§3.11). Client
  copy (e.g. a "coming soon" banner) lands with the web app phase.
- `SeedIdOption` (deterministic id pinning) is exported from command
  modules but absent from all tRPC input schemas — the API surface cannot
  set ids.
- Harness fix surfaced by this phase's longer suites: `createDb` now
  attaches the pg-required pool `error` listener (log-and-continue before
  close, silent during teardown). Without it, an idle pooled connection
  killed by the embedded server's shutdown crashed the test process
  (FATAL 57P01) — a pre-existing race, provoked more often once the suite
  grew. Relatedly, running the whole workspace's test task in parallel
  spawns enough embedded PG16 instances to trample each other on the WSL
  dev box — run `pnpm turbo test --concurrency=1` locally; CI is unaffected
  (shared pg service via TEST_DATABASE_URL).
