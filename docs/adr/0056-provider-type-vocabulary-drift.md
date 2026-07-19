# ADR-0056 — Provider-type vocabulary drift (single-sourced CHECK, billing vocabulary, seed schema preflight)

**Status:** Accepted
**Slice:** standalone (CLAUDE.md slice discipline — a post-merge remediation
spanning closed Phases 3 and 6, therefore its own branch/ADR, not a reopen
of either), treated fix-forward per the #76 precedent (ADR-0031).
**Builds on:** ADR-0055 (multi-country catalog, migration `0015`),
ADR-0009 (billing revenue model, `BILLING_CATEGORIES`), ADR-0005
(directory seed pipeline).

## Context — the incident

Immediately after ADR-0055 merged, a real-database seed run
(`pnpm --filter @mesomed/api seed`) against the **preview Railway
database** failed with a raw Postgres error: the `providers_type_check`
constraint rejected `provider_type = 'hair_transplant'` while inserting
one of the new sample facilities. The failure surfaced deep into seed
execution, after cities, categories and config rows had already been
written.

The initially reported cause was "migration 0015 never extended the
constraint". **That report was incorrect** and is corrected here.

## Root cause — operational, not code

`packages/db/migrations/0015_multicountry_catalog.sql` rebuilds
`providers_type_check` with all ten directory provider types, including
`hair_transplant`, `weight_management` and `physiotherapy`. The repo was
self-consistent throughout: schema, migration, seed data and tests all
agreed on the same vocabulary at every commit.

The preview Railway database was **never migrated to 0015 before it was
seeded** — step 3 of the Phase 8 deploy playbook (run migrations as the
owner role) was skipped, and step 4 (seed as the app role) was run
against a database still carrying the pre-0015 seven-value constraint.
The database was behind the code; the code was right.

**No migration 0016 was written, because none is warranted.** Shipped
migrations are never edited, and a new "defensive" migration that
re-asserted the same ten-value constraint would have been a no-op on any
correctly migrated database while _hiding_ the real failure — an
un-migrated environment would then have failed later, somewhere else,
with a less legible error. The fix for a behind-schema database is to
migrate it, and the fix for the incident is to make that failure state
impossible to reach silently.

## Why CI was green, and right to be

CI was not blind here and did not miss a defect:

- `packages/db/src/testing` builds **every** test database by running the
  real migration chain, so a test database is by construction at the
  current migration count.
- `apps/api/test/directory/seed.test.ts` runs the **full `seedDirectory`**
  against such a database, including the `hair_transplant`,
  `weight_management` and `physiotherapy` facility inserts through the
  real `upsertFacility` command.

CI therefore proves exactly what it can prove: that the migrations and
the seed agree. What it cannot observe is the state of an external,
long-lived database that no test controls. That observation belongs to
the runtime readiness check — and `apps/api/src/kernel/health.ts` was
already reporting the same shortfall on that environment, comparing the
applied-migration count against `expectedMigrationCount` from
`packages/db` and returning `unavailable` with
`"<n> of <m> expected migrations applied"`. The signal existed; the seed
simply did not consult it.

## The three real defects the incident exposed

The incident was operational, but investigating it surfaced three
genuine code defects. Each is fixed in this slice.

### 1. Duplicated provider-type vocabulary (fixed)

`packages/db/src/schema/directory.ts` carried **two independent
hand-maintained copies** of the same vocabulary: the
`DIRECTORY_PROVIDER_TYPES` tuple used for the Drizzle column enum, and a
second literal list spelled out inside the `providers_type_check`
`check(...)` SQL expression. They agreed, but nothing bound them —
adding an eleventh type to the tuple and forgetting the CHECK (or vice
versa) would compile, lint and typecheck clean, and fail only at insert
time against a real database.

The CHECK expression is now **derived from `DIRECTORY_PROVIDER_TYPES`**,
so the tuple is the single source of the vocabulary and the two can no
longer drift. The emitted SQL is unchanged, so no migration follows from
this change.

### 2. `BILLING_CATEGORIES` drift (fixed as an explicit exclusion — see below)

`packages/contracts/src/billing.ts` `BILLING_CATEGORIES` still listed
only the original seven types and never gained the three added by
ADR-0055, while its own doc comment claims it "mirrors the directory's
provider-type list". The mirror claim was silently false.

### 3. No seed schema preflight (fixed)

The seed performed no schema check. A behind-schema database failed
partway through with a raw `providers_type_check` violation — an error
that names a constraint, not a cause, and that led the first diagnosis to
the wrong conclusion. The seed now **refuses to start** against a
database whose applied-migration count is below
`expectedMigrationCount`, failing fast with a readable diagnosis and the
operator remedy (run the migrations) instead of a Postgres constraint
string. This reuses the readiness logic's existing comparison rather than
inventing a second notion of "schema current".

## Open decision — tier pricing for the three new provider types

**Owner ruling:** `hair_transplant`, `weight_management` and
`physiotherapy` are **explicitly EXCLUDED** from `BILLING_CATEGORIES`,
with a comment in `packages/contracts/src/billing.ts` naming them and
naming the reason — **tier pricing for these categories is unsigned
business input**. `apps/api/scripts/seed/data.ts` still flags
`FACILITY_PRICES` as "business sign-off pending"; inventing rates in a
contract file to make a list look complete would be worse than the gap.

The exclusion is now _explicit and documented_ rather than _missing and
unnoticed_ — that is the whole of the fix for defect 2.

**Consequence, stated plainly:** a provider of any of those three types
**cannot be assigned a billing model** until pricing is signed off.
`setProviderBillingModel`
(`apps/api/src/modules/billing/commands/provider-billing-config.ts`)
rejects them with a typed `VALIDATION` error
(`Provider type "<t>" has no billing category`). It fails **closed** —
no silent mispricing, no defaulting to another category's rates.

**This is recorded as an OPEN decision awaiting the owner, not as done.**
Closing it requires signed-off tier prices for the three categories;
only then do they join `BILLING_CATEGORIES` and gain rate rows. Until
then the three types are directory/catalog surface only.

## Blast radius, as investigated

- **Only the seed writes the three new provider types.** `providerType`
  is absent from the tRPC input contract for facility upserts, and
  `upsert-facility.ts` defaults admin callers to `"hospital"`
  (`input.providerType ?? "hospital"`). No client can produce one.
- **Widening a CHECK cannot invalidate existing rows** — every value
  admitted before is still admitted, so no data migration or backfill is
  implied on any environment, correctly migrated or not.
- **Identity's vocabulary is correctly untouched.**
  `packages/contracts/src/identity.ts` `PROVIDER_TYPES` keeps its five
  signup-time types; per ADR-0055 §6 the ten-value list is the
  **directory-side** vocabulary only, and no signup surface gains a type.

## Gate closure — what now fails CI for this class

Three new assertions close the class of defect, in the suites that own
each surface:

1. **Constraint-vs-TS drift** (`@mesomed/db` schema/migration suite): the
   provider-type values admitted by the live `providers_type_check` on a
   migrated test database must equal `DIRECTORY_PROVIDER_TYPES` exactly.
   **Honest note: this test is a green-by-design regression lock, not a
   bug reproduction.** Nothing was broken — the two lists agreed at the
   time it was written. It is red only for a _future_ commit that adds a
   type to one list and not the other, which is precisely the failure
   mode the duplication made possible.
2. **Billing vocabulary drift**, split across two suites because the two
   vocabularies live in packages that must not depend on each other. The
   `packages/contracts` suite pins the exclusion set itself and its
   disjointness from `BILLING_CATEGORIES`. The binding assertion —
   `DIRECTORY_PROVIDER_TYPES` equals `BILLING_CATEGORIES` ∪
   `BILLING_EXCLUDED_PROVIDER_TYPES` — lives in the `apps/api` billing
   suite, the first place both are in scope; putting it in
   `packages/db` would have required a new db→contracts package edge,
   and re-declaring the vocabulary inside contracts would have created a
   _third_ hand-maintained copy, reintroducing this slice's own defect.
   Together they mean a new directory provider type must be either
   priced or consciously excluded, which is exactly what
   `hair_transplant` was not. The exclusion set being asserted is what
   makes it a decision rather than an omission.
3. **Behind-schema database surfaces as a readable error** (`apps/api`
   seed suite): a database below `expectedMigrationCount` makes the seed
   refuse to start with the migration-shortfall message, rather than
   failing later on a constraint. This one _is_ a reproduction of the
   incident's diagnostic failure.

The deploy playbook (`docs/deploy/phase8-production-deployment.md`) is
updated at the step 3/4 boundary: migrate-before-seed is now stated as a
**hard precondition** with the seed's refusal behaviour and the operator
remedy, not merely an ordered step.

## Gate

Pre-slice: format GREEN · lint/typecheck 20/20 · test 11/11 tasks,
1246 tests / 156 files, zero failed · build 3/3 — the ADR-0055
post-slice state on main `9a30777` (PR #98 merged).

Post-slice (local, WSL, 2026-07-19): format GREEN · lint/typecheck 20/20
· test 11/11 tasks, 1256 tests / 160 files, zero failed · build 3/3.
The slice adds 10 tests across 4 new files: `packages/db` 20 → 22,
`packages/contracts` 69 → 72, `apps/api` 771 → 776.

CI on the pushed branch head is reported in the PR. Per CLAUDE.md,
"gate verified green" means CI green on `main`, so the gate closes only
once this merges and `main` is green.
