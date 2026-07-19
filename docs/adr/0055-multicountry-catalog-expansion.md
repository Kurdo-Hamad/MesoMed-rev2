# ADR-0055 — Multi-country catalog expansion (per-country tiles, deferred-visible categories, country scoping)

**Status:** Accepted
**Slice:** standalone (CLAUDE.md slice discipline — spans closed Phases 3
and 8, therefore its own branch/ADR, not a reopen of either).
**Builds on:** ADR-0005 (config-row country gating, seed pipeline),
ADR-0012 (cache seam), ADR-0016 (Phase 8 web), ADR-0032 (identity
event PII posture).

## Context

The catalog shipped in Phase 3 was Iraq-only in practice: ten Iraqi
cities, three built categories, one live country, and a homepage whose
tile set was fixed in web code. The owner asked for the launch catalog —
more Iraqi cities, the full category vocabulary, five additional live
countries, and a homepage that shows a different set of tiles per
country — without reopening either closed phase and without inventing
new architecture for it.

## Owner rulings

Four rulings bind this slice; they are recorded verbatim in substance
because each one closed a design fork that the code could have resolved
the other way.

- **(A) Reserved tile id, not a pseudo-category.** The homepage
  "Doctors" tile is the reserved id `doctors`, not a row in
  `categories`. Doctors are people with specialties, not a facility
  category; a pseudo-category row would leak into every category query,
  browse route and provider-type check that legitimately means
  "facility category".
- **(B) Category gating is a config row**, mirroring ADR-0005's country
  gating, plus a dated MM-PLAN-001 §6 amendment authorizing the
  `medical_marketplace` tile against §8's "do not build now" list.
- **(C) Provider registration is contract + column only.** The
  `countryCode` input and `provider_profiles.country_code` land now; the
  missing step-2 client form is **not** built in this slice, only
  recorded below as a named pre-launch follow-up.
- **(D) Country scoping, the search country column, and the web country
  switcher are built in-slice** — a multi-country catalog whose reads
  are not country-scoped is a bug, not a later phase.

The non-IQ display set is exactly: `doctors`, `hospital`,
`dental_clinic`, `hair_transplant`, `online_consultation` —
`beauty_center` is deliberately excluded from the non-IQ set. Iraq keeps
the full active category list.

## Decisions

### 1. Per-country display is a config row; the doctors tile is reserved

`directory.category_display` (`packages/config`,
`categoryDisplaySchema`) maps uppercase ISO2 → an ordered array of tile
ids, each a category slug or the reserved literal `doctors`
(`DOCTORS_TILE_ID`, declared in `packages/contracts` and re-exported by
`packages/config` — contracts must not depend on config, so the literal
lives on the contracts side of that edge).

`resolveCategoryDisplay` fails **open**: a missing config entry or an
unlisted country resolves to `null`, and the caller renders the full
active category list in display order with no doctors tile. Iraq is
deliberately unlisted for exactly that reason — the IQ homepage is the
fallback, so adding an Iraqi category needs no config write.

`directory.listHomepageTiles` (public, country-gated like every other
public read, cache-aside key
`directory:taxonomy:homepage-tiles:<country>`) returns the
`homepageTileSchema` discriminated union — `{ kind: "doctors" }` or
`{ kind: "category", slug, name, iconKey, status }`. Configured tile ids
that resolve to no active category are skipped silently: a config row
must not be able to 500 the homepage.

Both new config surfaces are read through cache-aside taxonomy queries,
and a config write emits no directory event — so an admin flip reaches
`listCategories`/`listHomepageTiles` only after the taxonomy TTL expires
or the next directory event invalidates the entry. This is the existing
behaviour of country gating in `listCountries`, inherited rather than
introduced; it is acceptable for launch-time catalog changes and is not
a live kill switch. Making config writes invalidate taxonomy cache
entries is the fix if that ever matters.

### 2. Deferred-visible categories: gating fails OPEN, on purpose

`directory.category_gating` (category slug → `active | coming_soon`)
lets a category be _visible and unbookable_ rather than absent.
`medical_marketplace` and `online_consultation` seed as `coming_soon`;
their tiles render, and `/directory/[category]` serves a trilingual
Coming Soon landing with `robots: noindex` instead of a browse grid.

**The fail direction diverges from country gating and the divergence is
deliberate.** ADR-0005 fails country gating _closed_ because an unlisted
country is a country we have made no promise about, and a config outage
must never open a market. Category gating is the mirror case: the
categories table is the authority on what exists, and an unlisted
category is the normal state (only two rows are listed). Failing closed
would mean a config read blip silently blanks the entire catalog —
strictly worse than briefly showing a category as active when it was
meant to read Coming Soon. As with country gating, only `NOT_FOUND` is
absorbed; every other config failure propagates, so an outage still
cannot masquerade as a status.

Nothing is bookable behind a deferred-visible tile: zero providers are
seeded for either category, and facilities have no booking path at all
(booking runs off doctor schedules), so the Coming Soon landing is the
only reachable state by construction, not by suppression.

**F-27 correction.** An earlier framing cited MM-QA-004 F-27 as the
precedent for deferred-visible scope. That is wrong and is corrected
here: F-27 was a documentation-drift finding — two stale "marketplace
service" comments in `packages/domain/directory`, reworded and closed in
ADR-0052 — and carries no design weight for this slice. The real
precedents are **ADR-0005** (gating as a config row with a stated fail
direction), **ADR-0019** (the mobile `COUNTRY_COMING_SOON` full-screen
state — deferred surfaces render, they do not 404), and MM-PLAN-001 §6's
governing principle from ADR-0009: _deferred behavior is wired code
behind config flags, never missing code_.

### 3. §8 medical-marketplace override and the plan amendment

MM-PLAN-001 §8 lists "medical marketplace category" under _do not build
now_. Ruling (B) is an explicit owner override, scoped narrowly: a
taxonomy row, a homepage tile and a Coming Soon landing. No marketplace
domain, tables, events, listings or payments are built, so §8 stands for
everything it was written to defer. The override is logged as a dated
(2026-07-19) §6 amendment referencing this ADR, together with the second
correction that amendment carries — the Phase 8 line fixing the homepage
at "7 categories + home-nursing" is superseded by config-driven
per-country display sets.

### 4. Provider registration: contract + column landed, form deferred

`completeProviderSignupInputSchema` gains optional `countryCode`, and
the command persists `countryCode ?? "IQ"` into the new
`provider_profiles.country_code` (NOT NULL DEFAULT `'IQ'`). Country is
queryable state, not event-carried, so ADR-0032's identity event payload
surface is untouched.

The gap is stated plainly: **there is no client step-2 form**, so no
real provider can supply a country yet — every signup takes the `IQ`
default. Per ruling (C) the form is not built here. It is recorded as a
named pre-launch follow-up slice, **`provider-registration-step2-client`**
(step-2 provider form + country picker), which must land before any
non-IQ provider onboarding. Until it does, non-IQ catalog content is
seed-sourced only.

### 5. Country scoping semantics

List surfaces — `browseFacilities`, `browseDoctors`, `homepageFeed` —
filter to `ctx.country` by joining city → country ISO. `homepageFeed`'s
cache key gains the country dimension.

Detail procedures are **not** country-filtered. A direct link to a
facility or doctor keeps working across countries; `assertCountryActive`
already refuses reads for a country that is not live, which is the
guarantee that matters. Filtering details would break shared links for
no security gain.

Two exclusions are accepted pre-launch and named here so they are not
rediscovered as bugs:

- **Doctors with a NULL `cityId` are excluded** from country-scoped
  browse (they cannot be attributed to a country). Every seeded doctor
  has a city.
- **Search rows with NULL `country_iso` are excluded.**
  `search_documents.country_iso` is nullable because pre-existing
  documents were indexed from events that had no country; the column is
  backfilled when the seed re-run re-emits the directory events. Until
  that re-run, previously indexed rows are invisible to search.

`upsertFacility` / `upsertDoctorProfile` emit `countryIso` on their
snapshot payloads as an **optional, nullable additive field** — no new
event, no version bump, so ADR-0047's F-18 name-set pin is unaffected.

### 6. Directory provider-type vocabulary extended

Migration `0015_multicountry_catalog.sql` rebuilds
`providers_type_check` to admit `hair_transplant`, `weight_management`
and `physiotherapy` — required for the new sample facilities to insert
through the real `upsertFacility` command. This is the **directory-side
vocabulary only**; identity's `PROVIDER_TYPES` (the five signup-time
types) is untouched, and no signup surface gains a type.

### 7. Seed expansion

Nine cities (four Iraqi — Kirkuk, Baghdad, Mosul, Kalar — and Tehran,
Istanbul, Delhi, Amman, Berlin), eight categories (`c21`–`c28`), IR/TR/
IN/JO/DE flipped to `active`, and 32 sample facilities (`d31`–`d62`) all
inserted through the real commands. `seedCategoryConfig` writes the two
new config rows through the new admin commands rather than raw SQL, so
the seed exercises the same path an operator uses.

Points of record:

- **AE remains `coming_soon`.** The country gating map is append-only in
  spirit; UAE was not part of this launch set and was deliberately not
  flipped.
- **Chamchamal keeps display order 14.** Explicit display orders were
  assigned to all cities to slot the four new Iraqi ones; chamchamal's
  existing position was preserved rather than compacted.
- **Seeded doctors now rotate over Iraqi cities only.** With non-IQ
  cities in the array, the old rotation would have scattered demo
  doctors across countries that have no doctor onboarding yet. The
  rotation is still deterministic, so a re-seed moves some existing demo
  doctors to a different Iraqi city — expected, IQ-only, demo data.
- **Category-vs-specialty dual representation.** `laboratory`,
  `physiotherapy` and `weight_management` now exist both as facility
  categories and as doctor specialties. That is intentional: a lab is a
  facility you visit, and a physiotherapist is a person you book. The
  two vocabularies are separate tables and stay separate.
- **`SEED_DRAIN_TIMEOUT_S`** (default 60) makes the demo seed's
  outbox-drain deadline configurable, documented in
  `apps/api/.env.example`. Per ADR-0007's Phase 3 drain-timeout note,
  the default was **not** widened — the knob exists so a slow machine
  can be profiled before anyone argues for a larger default; the seed
  and dev-embedded deadlines are otherwise untouched.

### 8. Clients

Web gains a cookie-driven country context (`mesomed-country`, default
`IQ`) forwarded as `x-mesomed-country` from both the server helper and
the client tRPC link, a header country switcher listing only `active`
countries, the tile-driven homepage, the Coming Soon landing, and
country-filtered city selects. **Reading that cookie makes previously
static pages dynamic** — accepted as the cost of per-country rendering;
the taxonomy caches absorb the extra query load.

**Mobile is untouched this slice** and remains IQ-pinned. It keeps
consuming `listCategories` and is unaffected by the additive `status`
field; a mobile slice adopts the tile surface later.

### 9. Human gate — translations not self-certified

All new `ar`/`ckb` strings in this slice (city and category names,
`web.comingSoon.*`, `web.countrySwitcher.label`, `web.home.tiles.doctors`,
and the 32 seeded facility names) are **machine-drafted and PENDING
NATIVE-SPEAKER REVIEW**. Per CLAUDE.md ("human gates are never
self-certified") this is an explicit open human gate; it is not marked
done by this ADR and must be signed off by the owner before launch.

## Gate

Pre-slice: format GREEN · lint/typecheck 20/20 · test 11/11 tasks,
1194 tests / 147 files, zero failed · build 3/3 — the ADR-0054
post-slice gate on the tree that squash-merged verbatim to main
`65604e2`.

Post-slice (local, WSL, 2026-07-19): format GREEN · lint/typecheck 20/20
· test 11/11 tasks, 1246 tests / 156 files, zero failed · build 3/3.
The slice adds 52 tests across 9 new files (api 771, web 37, contracts
69, config 39; the remainder unchanged).

CI on the pushed branch head `23d03f1` (PR #98): ci, e2e, analyze,
CodeQL, docker and secrets all pass. Per CLAUDE.md "gate verified green"
means CI green on `main`, so the gate closes only when this merges and
`main` is green — this ADR records the PR run, not that final state.
