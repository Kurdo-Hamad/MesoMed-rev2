# ADR-0003 — Phase 1 Kernel: Outbox, Event Contracts, Authz, Config, Readiness

**Status:** Accepted
**Date:** 2026-07-10
**Phase:** 1 — Kernel (MM-PLAN-001 §5)

## Context

Phase 1 delivers the shared kernel everything after it stands on: the
Drizzle client factory and migration runner with a real-Postgres test
harness, the transactional outbox with a pg-boss dispatcher, versioned
event contracts with type-branded names, the kernel services (authz role
guard, request-scoped context, config service, typed error model), the
tRPC root router wiring, and the liveness/readiness split. It also closes
the MM-QA-001 findings deferred to this phase: F-13 (readiness), F-19
(`AppError` placement), F-20 (event-name branding + registry). No business
module was built; identity is Phase 2.

The governing principle from ADR-0002 carries over: **every guardrail
ships with a meta-test proving it fires.** The Phase 1 gate tests are
listed under Verification below.

## Decisions

1. **Outbox schema (kernel-owned tables in `packages/db`).**
   `domain_events` carries the plan's columns (id, name, version,
   aggregate_type, aggregate_id, payload jsonb, occurred_at, published_at,
   attempts) **plus `status` and `last_error`** — the plan's own
   requirement of a "dead-letter status" needs a status column; lifecycle
   is `pending → published → processed | dead`, constrained by a DB CHECK
   and indexed on `(status, occurred_at)` for the dispatcher poll. Kernel
   infrastructure tables (`domain_events`, `processed_events`,
   `config_entries`) are defined in `packages/db/src/schema/kernel.ts`:
   they belong to the shared kernel, not to any module, so §3.1 module
   ownership is untouched — module tables land in
   `apps/api/src/modules/*/schema.ts` from Phase 2 and `packages/db`
   re-exports them as the schema hub.

2. **Delivery semantics: at-least-once publication × transactional
   idempotency claims = effectively-once handlers.** `emit(tx, event)`
   validates the envelope against the registry and inserts the outbox row
   on the caller's transaction. The dispatcher pump enqueues pending rows
   to pg-boss **before** flipping them to `published` (a crash in between
   re-sends rather than loses; `singletonKey = event id` dedupes queued
   duplicates). Each handler runs inside its own transaction that first
   claims `processed_events (event_id, handler)` with
   `INSERT … ON CONFLICT DO NOTHING`; a taken claim makes re-delivery a
   no-op, and a failed handler rolls back claim and effects together.
   Handler names are therefore stable identities — rename one and it will
   re-run for every past event. Multi-instance safety comes from the
   idempotency claim, not from pump-side row locking; the pump itself
   assumes the launch topology of a single API instance (§1 rate-limit row
   makes the same assumption).

3. **pg-boss v12 (Postgres-only, no Redis).** One `domain-events` queue
   (retry limit/delay from env, exponential backoff, dead-letter target)
   plus a `domain-events.dead` queue whose worker marks the outbox row
   `dead`; `attempts` is incremented on the row per processing attempt and
   `last_error` records the final failure. Constructor options are pinned
   (`migrate: true`, `supervise: true`, `schedule: false` until Phase 7
   cron). The dispatcher exposes `pump()` and `redeliver(eventId)` as the
   ops/replay surface (`redeliver` is idempotent by construction — used by
   the gate tests, needed anyway for Phase 10 dead-letter replay).

4. **Event contracts brand names at the type level (F-20).**
   `defineEvent(module, event, version, payload)` in
   `packages/contracts/events` assembles `module.event.vN` — the name is
   never passed as a whole string, and the template-literal `EventName`
   type rejects bare strings at every kernel boundary. The registry
   (`createEventRegistry`) rejects duplicates and validates any envelope
   against its contract on emit and again on delivery. Runtime behavior
   and the type-level branding both have contract tests (including
   `@ts-expect-error` proofs).

5. **`AppError` moved to the kernel (F-19).** Only the server throws it,
   so the class (and the AppError↔TRPCError mapping from the ADR-0002
   remediation) now lives in `apps/api/src/kernel/errors.ts`;
   `@mesomed/contracts/errors` keeps only the pure `ErrorCode` constants
   that clients switch on. The tRPC init/formatter moved to
   `kernel/trpc.ts`; the root router stays outside the kernel because it
   will mount module routers, which the kernel must never import.

6. **Authz middleware + a real consumer.** `requireRole(...roles)` /
   `roleProcedure(...)` implement layer (a) of §3.6 (UNAUTHORIZED without
   a session, FORBIDDEN without the role — typed AppErrors). Sessions come
   from an injectable `SessionResolver` seam in the composition root,
   anonymous by default; Phase 2 plugs Better Auth into exactly that seam.
   A kernel-level `system` router provides `whoami` (context echo) and the
   admin-gated `outboxStats` (outbox depth by status — the Phase 10 ops
   signal), so the role guard has a genuine in-app procedure and the
   denial meta-test runs through the real composition root, not a fixture.

7. **Config service in the kernel; `packages/config` stays reserved.**
   `createConfigService(db)` is the generic Zod-validated loader over
   `config_entries` (schema-checked `get`/`set`, 30s TTL cache, explicit
   `invalidate`, write-through invalidation). The domain config schemas
   the plan assigns to `packages/config` (countries, categories, tiers)
   arrive with their first consumer in Phase 3 — building them now would
   violate the second-adapter rule (§3.8's "never speculatively").

8. **Migrations are a release step, not an API boot step.** drizzle-kit
   generates SQL in `packages/db/migrations`; `db:migrate` (or the test
   harness / release tooling via `@mesomed/db/migrate`) applies them. The
   API asserts rather than applies: readiness compares the count in
   `drizzle.__drizzle_migrations` (schema/table pinned, not defaulted)
   against `expectedMigrationCount`, which is inlined into the build from
   the migrations journal — so the artifact knows what it expects without
   shipping SQL files, and the Docker image is unchanged.

9. **Liveness/readiness split (F-13).** `/health` never consults
   dependencies; `/ready` reports `postgres` (SELECT 1), `migrations`
   (applied ≥ expected) and `dispatcher` (started) checks and flips to 503,
   both built once in `kernel/health.ts` against contracts schemas
   (`readinessResponseSchema`). Boot itself fails fast when Postgres is
   unreachable: a single-instance API that cannot reach its database has
   nothing to serve, and half-booting it would only turn a crash-loop
   signal into a quieter degraded state.

10. **Test-DB harness resolves a real Postgres 16 in priority order.**
    `@mesomed/db/testing` provisions an isolated, migrated database per
    test file: `TEST_DATABASE_URL` (CI pg service container; unique
    database per call, `CREATE DATABASE` retried under contention) →
    Testcontainers `postgres:16-alpine` (when a Docker daemon exists) →
    **embedded Postgres binaries** (`embedded-postgres`, pinned to the
    PG16 line). All three run the same real PostgreSQL major, so the
    outbox gate is exercised identically everywhere. All integration
    tests consume `buildServer()` with the harness URL — no hand-wired
    app copies (F-05 discipline).

11. **Request-scoped context.** `{ requestId, session, locale, country }`
    plus the kernel services, resolved per request: locale from
    `x-mesomed-locale` validated against the platform locales (default
    ckb), country from `x-mesomed-country` (ISO 3166-1 alpha-2, default
    from `DEFAULT_COUNTRY` env, itself defaulting to IQ). Platform locale
    codes moved into `@mesomed/contracts/i18n` (see Deviations #3).

## Deviations and discoveries

1. **`domain_events` gained `status` and `last_error`** beyond the plan's
   §5 column list — additive, required by the dead-letter scope item
   (decision 1).

2. **"Testcontainers locally" was not executable in the actual dev
   environment** (WSL2 without a Docker daemon and without root). Since
   the gate demands the integration suite green locally, the harness
   gained the embedded-Postgres fallback (decision 10). Testcontainers
   support remains first in line whenever Docker is present; CI uses the
   pg service container. `pnpm-workspace.yaml` `allowBuilds` now permits
   `@embedded-postgres/linux-x64`'s postinstall (binary symlink
   hydration) and explicitly denies `cpu-features`/`ssh2` (optional
   native accelerators of testcontainers' ssh2 dependency; the pure-JS
   fallback suffices for a test harness).

3. **Platform locale codes moved to `@mesomed/contracts/i18n`.** The API
   (NodeNext module resolution) cannot type-import `@mesomed/i18n`, whose
   JSON catalog imports require import attributes that the web/mobile
   bundler toolchains haven't all stabilized on. Locale codes are contract
   data anyway (request headers, user preferences); `packages/i18n` keeps
   the catalogs and now `satisfies`-asserts at compile time that every
   platform locale has one, so the two cannot drift. `packages/i18n`
   gained a dependency on `@mesomed/contracts`.

4. **pnpm linker drift discovered (ADR-0001 §6 erratum).** pnpm 11 ignores
   `.npmrc`'s `node-linker=hoisted` (project config moved to
   `pnpm-workspace.yaml`), so the workspace has been isolated-linked for
   some time — including the green Phase 0 CI runs and the Docker image
   build. Everything remains green under isolated linking, so Phase 1
   leaves it as-is rather than churning the layout mid-phase; ADR-0001's
   Expo/Metro hoisting rationale must be revalidated when mobile work
   resumes (Phase 9), and the stale `.npmrc` line should be resolved then.

5. **ESLint base config change.** The `import-x/no-extraneous-dependencies`
   allowlist now includes `**/src/testing/**` so a package can ship a test
   harness entrypoint whose providers stay devDependencies; production
   entrypoints never import from `src/testing`.

6. **The error-contract test keeps probe procedures.** The app deliberately
   has no endpoint whose contract is "always throws", so
   `apps/api/test/errors.test.ts` mounts throw-only probes on the real
   kernel `t` instance and the real context factory — the subjects under
   test — rather than through the root router. Everything else in the
   suite goes through `buildServer()`.

7. **MM-PLAN-001 §6 amendment log reconciled.** The log's "ADR-0002" /
   "ADR-0003" labels were logical decision numbers that no longer match
   the files on disk (0002 is the remediation batch; 0003 is this
   document). §6 now cites where each decision actually lives — the RLS
   rejection in plan §3.6/§5 Phase 5 (CLAUDE.md convention #6), the
   week-number reclassification in the §5 preamble — plus an explicit
   ADR filename index. Neither decision was retro-fitted with a fake ADR
   file.

8. **Windows/WSL dual use of the working copy.** The repository's
   `node_modules` had been installed by Windows pnpm (isolated layout,
   Windows store paths) and is unusable from WSL; Phase 1 was built and
   verified from a Linux-filesystem clone pushed to the same origin.
   Nothing in the repo changed for this beyond the facts recorded here.

## Verification (Phase 1 gate)

- `apps/api/test/outbox.test.ts` — command tx writes state row + outbox
  event atomically; rollback leaves neither; contract-violating and
  unregistered emits write nothing.
- `apps/api/test/dispatcher.test.ts` — subscriber receives an event
  exactly once under forced retry (attempts recorded, durable effect
  once); duplicate re-delivery is a no-op via the idempotency claim; a
  poisoned event lands in dead-letter with `status=dead`, attempts and
  `last_error` recorded.
- `apps/api/test/authz.test.ts` — anonymous → 401 UNAUTHORIZED,
  wrong role → 403 FORBIDDEN, admin → 200, through the real composition
  root and the real admin procedure.
- `apps/api/test/config.test.ts` — Zod-validated round-trip; cache proven
  by a stale read after an out-of-band write; invalidation proven by the
  subsequent fresh read; invalid writes rejected before touching the DB.
- `apps/api/test/ready.test.ts` — `/ready` green on a migrated database;
  flips to 503 when Postgres becomes unreachable while `/health` stays 200.
- `packages/db/test/migrations.test.ts` — fresh-database migration,
  idempotent re-run, journal count matches the readiness expectation,
  outbox defaults and status CHECK enforced at the DB level.
- `packages/contracts/test/events.test.ts` — envelope/registry runtime
  contract plus type-level branding proofs.
- `apps/api/test/otel.test.ts` (updated) — the built artifact now boots
  against a provisioned database and still exports real spans and shuts
  down cleanly (dispatcher + pool teardown included, exit code 0).

## Consequences

- Phase 2 modules get their machinery for free: define event contracts in
  `packages/contracts/events`, register them and their subscribers in the
  composition root, `emit()` inside command transactions, guard procedures
  with `roleProcedure`, and read config through the kernel service.
- The session resolver seam is the single integration point Better Auth
  must fill; tests already demonstrate the pattern.
- Deployments must run `db:migrate` before (or alongside) rollout;
  readiness will hold instances out of rotation until the database
  matches the build's expectations.
- Handler names in `processed_events` are permanent identities; renames
  re-deliver history. Document handler names in module ADRs as they land.
