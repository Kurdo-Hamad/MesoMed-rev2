# MM-ARC-002 — MesoMed Final Strategic Architecture Package

**Status:** Draft for approval (becomes locked on Hakeem's sign-off)
**Date:** 2026-07-11
**Basis:** MM-PLAN-001 (locked) · MM-DEC rev02 (locked) · CLAUDE.md · MM-QA-001 · HANDOFF-001 · MM-REPORT-001 (+ SUPPLEMENT-001) · execution state: Phases 0–5 complete and gated, Phase 6 kickoff pending
**Rule of this package:** it does not rewrite MM-PLAN-001 or the phase sequence. Where a recommendation would amend a locked document, it says so explicitly in §0 and in place. Nothing here is silently contradictory.

**Contents**

| #   | Document                       |
| --- | ------------------------------ |
| 0   | Locked-document conflict notes |
| 1   | Architecture Review            |
| 2   | Technical Debt Forecast        |
| 3   | AI Engineering Constitution    |
| 4   | Architecture Decision Review   |
| 5   | Long-Term Scalability Review   |
| 6   | Security Review                |
| 7   | Performance Review             |
| 8   | Product Architecture Review    |
| 9   | Database Architecture Review   |
| 10  | Operations & DevOps Strategy   |
| 11  | Quality Assurance Strategy     |
| 12  | Audit Strategy                 |
| 13  | Risk Register                  |
| 14  | Future ADR List                |
| 15  | Final Executive Review         |

---

# Document 0 — Locked-Document Conflict Notes

Recommendations in this package that cannot be adopted without amending a locked document. Everything else in the package is additive.

| Recommendation                                                          | Conflicts with                                                                                 | Required amendment                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dormant-profile step-up verification before history attach (§1.4, §6.2) | MM-DEC rev02 §2 (OTP alone proves ownership and claims history)                                | **MM-DEC rev03**: claim of a profile dormant > N months requires a second factor (DOB match, last-appointment challenge, or manual review) before history attaches. Credentials can still be created on OTP alone.                                                                                                                                                                                                                                                                                                                    |
| PII-minimized event payloads (§1.6, §6.5)                               | Practice implied by MM-PLAN-001 §3.3 (payload schemas are forever) — not the convention itself | **Partially realized:** ADR-0010 (clinical prescriptions extension, inter-phase) already applies id-only payloads to `clinical.prescription_issued/amended/discontinued.v1`, establishing precedent. Remaining ADR (not a plan change) extends the same rule to billing/identity/booking event families: payloads carry identifiers, not patient PII, wherever a consumer can re-read via query. Where PII is unavoidable, field-level crypto-shred applies. Existing v1 events already shipped stay; new versions follow the policy. |
| Search-text normalization for Arabic-script/ckb (§1.7)                  | None if Phase 3 already normalizes; otherwise a Phase 3 retrofit inside the search module      | Verify against the Phase 3 ADR; if absent, retrofit is an additive change to the indexer, no contract change.                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Worker process split (§1.5)                                             | None — same codebase, same image, second process role. Does not violate "single BFF".          | ADR when triggered.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

Everything else: no conflicts.

---

# Document 1 — Architecture Review

Independent review of the architecture as locked, assuming full-scale implementation from Phase 6 onward. Format: finding → engineering justification → recommendation → when. Severity: **Critical** = will cause a rewrite or a breach if unaddressed · **High** = expensive later, cheap now · **Medium** = real debt, contained · **Watch** = correct today, has a trigger condition.

## 1.1 What is structurally right (keep, defend)

- **Event-driven modular monolith + pragmatic CQRS + transactional outbox** is the correct 10-year shape for this team size and domain. It gives microservice-grade module boundaries without distributed-systems tax, and the outbox gives an honest consistency story (strong where money/health, eventual where discovery).
- **Vertical slices with exclusive table ownership (convention #1)** is the single highest-value rule in the system. Every future extraction, every AI-agent session, every audit leans on it.
- **The two-layer authz + clinical-tier-only RLS decision** is correct and empirically grounded (130 assertions guarding an unused path in rev01). Do not relitigate.
- **Gate-not-calendar phase discipline with ADR closure** is the governance mechanism that makes AI-velocity development safe. It is as important as any technical decision.
- **Adapters-at-the-composition-root (convention #8)** with "second adapter only when second vendor is real" is the right anti-over-engineering posture.
- **Config-over-code for countries/categories/gateways (convention #9)** is what makes the 10-year multi-country claim credible at the application layer (see §1.10 for where it is _not_ sufficient).

## 1.2 CRITICAL — Phone-keyed identity vs. phone-number recycling

**Finding.** Convention #7 and MM-DEC rev02 key patient profiles on normalized phone number, and OTP proves _current control_ of that number, which then attaches the full appointment/medical history. Iraqi MNOs (Asiacell, Zain, Korek) recycle inactive MSISDNs, typically after 90–180 days of inactivity. A recycled number means a stranger can pass OTP legitimately and inherit the previous holder's medical history. This is not an implementation bug — it is a hole in the identity model itself, and it is a medical-privacy breach class, the worst class this platform has. **Blast radius update (post ADR-0010, inter-phase clinical extension):** the attached history is no longer just appointments and visit notes — it now includes doctor-issued prescriptions (medication chains), the patient's self-reported blood type and allergies, and patient-reported medications. A wrongful claim hands a stranger someone else's medication history and allergy profile, not just a booking log. The fix (MM-DEC rev03) and its urgency are unchanged; the cost of not fixing it before Phase 7 is larger than originally scoped.

**Justification.** The OTP proves "controls the SIM today", the system treats it as "is the person the history belongs to". Those are the same person only while the number hasn't changed hands. In a market with high prepaid churn, they will diverge at meaningful volume.

**Recommendation.** MM-DEC rev03 (see §0): split _credential creation_ from _history attachment_. OTP alone → account exists, empty. History attaches when (a) profile activity is recent (< N months, N tuned to telco recycling windows, start at 6), or (b) a step-up passes: DOB match, challenge on last appointment (doctor/city/month), or admin manual review. Every history-attach is a domain event (`identity.profile_claimed.v1` already exists — add a `claim_evidence` field in v2) and is audited. If the profile has a verified email, notify it on claim.

**When.** Must be locked before Phase 7 (real OTP delivery). Phase 2's mock-OTP claim flow can be amended in the same session that wires the real adapter.

## 1.3 HIGH — tRPC contract drift against mobile clients that cannot be force-updated

**Finding.** Web deploys in lockstep with the API; the Expo app does not — store review plus user update lag means months-old clients call the current API. tRPC has no versioning mechanism; the plan's event contracts are versioned but the _procedure_ contracts are not.

**Justification.** The first breaking change to a procedure input/output after Phase 9 ships will strand fielded clients with opaque errors. This is the mobile analogue of "event contracts are forever" and needs the same rule.

**Recommendation.** ADR before Phase 8 ends: (1) procedure contracts are additive-only once mobile consumes them — new required inputs, removed fields, changed semantics = new procedure name, old kept until adoption metrics allow removal; (2) kernel middleware reads an `x-app-version` header from mobile and can return a typed `UPGRADE_REQUIRED` error below a minimum supported version (config table, per convention #9); (3) CI contract tests pin the _previous_ release's client schemas against the current router (a frozen snapshot per release) so a breaking change fails the build, not the field. EAS Update softens but does not remove this (native-module changes still require store builds).

**When.** Policy ADR by end of Phase 8; enforcement in Phase 9 DoD.

## 1.4 HIGH — Single-Postgres concentration (OLTP + queue + search + sessions + config)

**Finding.** One PostgreSQL instance carries: booking OLTP (strong consistency), the outbox and all pg-boss job churn, FTS/trigram search reads, Better Auth session reads on every authenticated request, and config reads. This is the deliberate, correct launch shape — but it means every subsystem degrades together, and the failure is gradual (vacuum pressure, connection saturation), not a clean outage.

**Justification.** Outbox + pg-boss are high-churn (insert/update/delete cycles) → dead-tuple accumulation → autovacuum pressure on the same instance serving booking transactions. Session lookups are a per-request hot read. Search trigram scans are CPU-heavy. None of these is a problem at launch scale; all of them compound.

**Recommendation.** No architecture change. Instead, a _monitored trigger list_ (Phase 10 dashboards must include these):

| Signal                                    | Threshold → action                                                            |
| ----------------------------------------- | ----------------------------------------------------------------------------- |
| Connection count vs. max                  | > 60% sustained → pgbouncer in transaction mode                               |
| Outbox dispatch lag p95                   | > 30s sustained → dedicated worker process (§1.5)                             |
| Dead-tuple ratio on outbox/pg-boss tables | > 20% → per-table autovacuum tuning, then time-partitioning (§9)              |
| Search query p95                          | > 150ms at current volume → Meilisearch adapter (already planned as the exit) |
| Session-read share of DB load             | > 15% → in-process session cache with short TTL behind kernel interface       |

**When.** Dashboards + thresholds are a Phase 10 gate item; add them to the Phase 10 kickoff prompt.

## 1.5 HIGH — API and outbox workers share one process

**Finding.** pg-boss dispatch, cron reminders, and event subscribers run inside the same Node process as latency-sensitive tRPC handlers. A burst of notification fan-out or an AI-call retry storm steals event-loop time from booking.

**Justification.** Node is single-threaded per process; "eventually consistent" work and "p95 < 100ms" work in one event loop means the eventual work sets the tail latency of the strong work.

**Recommendation.** The F-05 composition-root fix already makes this cheap: same codebase, same Docker image, `ROLE=api|worker|all` env switch in the entrypoint — `all` at launch (one instance), split to two processes the moment §1.4's lag threshold trips. No module changes, no new infra. Record the trigger in an ADR now so it isn't improvised.

**When.** Build the `ROLE` switch into the composition root during Phase 6 or 7 (it is ~20 lines while the entrypoint is small); _use_ it only when triggered.

## 1.6 HIGH — PII inside immutable event payloads vs. erasure obligations

**Finding.** Convention #3 makes event payloads permanent contracts; the outbox persists payloads as jsonb; Phase 10 plans crypto-shred for PII where audit immutability conflicts with erasure. Booking/identity events will naturally want patient name and phone in the payload — which turns the outbox and any event archive into an un-erasable PII store.

**Recommendation.** Policy ADR (see §0): events carry _identifiers_, consumers re-read current PII via published queries at handling time. Where a payload must carry PII (e.g., guest-booking notification needs the phone at dispatch), that field is encrypted with a per-subject key so crypto-shred works uniformly across rows, events, and logs. Cheap to adopt at Phase 6 (few event families exist); expensive after Phase 7's communication fan-out multiplies consumers. **Precedent now exists:** ADR-0010 (inter-phase clinical prescriptions extension) already applies this rule to the three new `clinical.prescription_*.v1` events — cite it directly rather than proposing the policy from scratch.

**When.** Lock before Phase 6 emits `billing.*` events, ideally in the Phase 6 ADR.

## 1.7 MEDIUM — Arabic-script and Sorani search quality on Postgres FTS

**Finding.** PG FTS has no Kurdish (ckb) dictionary and only a weak Arabic stemmer; trigram matching is script-sensitive — alef/hamza variants (أ/إ/آ/ا), teh marbuta (ة/ه), Persian-vs-Arabic kaf/yeh (ک/ك, ی/ي — Sorani text mixes these constantly), and ZWNJ all fragment matches. Users typing "دکتۆر" and content stored with the other kaf simply won't match.

**Recommendation.** A pure text-normalization function (fold the variant classes above, strip diacritics/tatweel) in `packages/domain/search`, applied at _index_ time and _query_ time. It is pure logic → unit-testable with real ckb/ar fixtures, and it carries into the future Meilisearch adapter unchanged (Meilisearch also won't fold Sorani variants for you). Verify whether the Phase 3 indexer already does this; if not, retrofit is additive.

**When.** Verify now (one look at the Phase 3 ADR/code); retrofit before Phase 8 makes search user-visible.

## 1.8 MEDIUM — No caching layer is defined anywhere

**Finding.** The plan correctly defers Redis, but defines no caching strategy at all. Homepage feed, directory pages, taxonomy, and config are read-heavy, slowly-changing, and public — the exact profile that wants caching — and without a defined seam, caching will be improvised per-page in Phase 8 (the pressure phase).

**Recommendation.** Three deliberate layers, no new infra: (1) HTTP/CDN caching for public reads — `s-maxage` + `stale-while-revalidate` on Next.js public pages and cacheable tRPC GET queries; (2) in-process TTL cache behind a kernel `CacheAdapter` interface (Map + TTL now, Redis-backed when horizontal — convention #8 pattern); (3) config service already caches (Phase 1) — keep it the only cached _authoritative_ data, everything else cache-aside with short TTLs. Invalidation via the events that already exist (directory/billing events bust directory caches).

**When.** ADR + `CacheAdapter` interface at Phase 8 start; do not build Redis.

## 1.9 MEDIUM — `directory` module is on a path to become the god module

**Finding.** Directory owns providers, doctor profiles, facilities, media, sections, taxonomy, promotions, countries, cities — the largest table count of any module, and Phase 8's homepage/featured logic will pull more into it.

**Recommendation.** No split now (premature). Enforce two internal disciplines so a future split stays cheap: (a) inside the module, keep `taxonomy/`, `facilities/`, `providers/`, `promotions/` as separate sub-slices with their own commands/queries; (b) other modules consume directory _only_ via published queries (convention #1 already says this — the point is that directory must also publish narrow queries, not one wide "get everything" query). Split trigger: when directory's schema exceeds ~20 tables or admin taxonomy work starts colliding with public-directory work in the same files.

## 1.10 WATCH — Multi-country is config-solved at the app layer, unsolved at the data layer

**Finding.** Convention #9 makes adding a country a config change — correct for behavior. It does not address _health-data residency_: several plausible expansion jurisdictions (GCC states in particular) require health data stored in-country. The architecture assumes one database in eu-central.

**Recommendation.** Do not build anything. Record the escape hatch as an ADR: the expansion unit is a _cell_ — a full deployment of the monolith (API + DB) per residency zone, with the config tables defining which countries a cell serves. The modular monolith supports cells naturally; shared-DB sharding would not. Country-onboarding checklist gains a legal data-residency review as step 1.

**When.** ADR before the first non-Iraq country is seriously scoped. Nothing before that.

## 1.11 WATCH — No organization/tenant entity in the identity model

**Finding.** Identity models individuals (patient, doctor, secretary, admin). Hospitals and labs are _listings_, not organizations with staff, seats, and delegated admin. Telemedicine groups, hospital-employed doctors, insurance, and enterprise/government integrations all eventually need "user belongs to organization with role in that organization" — and bolting a tenant dimension onto a mature per-user authz model touches every handler.

**Recommendation.** Do not implement. Reserve the concept: one ADR sketching `organization` + `organization_membership(user, org, org_role)` and the rule that facility-staff features, when they arrive, extend the two-layer authz with an org-scope check in the ownership layer (not the role layer). This keeps the future change local to the identity module + handler ownership checks.

**When.** ADR by end of Phase 8; implementation only when the first org-shaped feature (hospital staff accounts) is scoped.

## 1.12 WATCH — Better Auth as a load-bearing young dependency

**Finding.** Better Auth is the right choice for the requirements (two parallel credential strategies, Drizzle adapter, sessions in your Postgres) but it is a younger OSS project than anything else load-bearing in the stack.

**Recommendation.** The mitigation is already mostly structural: sessions and users live in _your_ tables via the Drizzle adapter (data portability), and MM-DEC defines the flows independently of the library. Add: pin the version, upgrade deliberately (never as a side effect of another change), and keep the Phase 2 auth integration suite comprehensive enough that a library swap is a testable event rather than a rewrite. No abstraction layer over Better Auth — that would be speculative (convention #8's own logic).

## 1.13 WATCH — Eventual-consistency lag is a product behavior with no SLO

**Finding.** Directory visibility flips on billing events; search indexes refresh on directory events; notifications dispatch from the outbox. The plan tests _correctness_ of these paths but sets no target for _lag_ — and an admin who records a tier payment will judge the system by how fast the facility appears.

**Recommendation.** Set one number now: outbox event → subscriber-effect visible p95 ≤ 10s at launch scale. Emit dispatch-lag as a metric from Phase 6 onward (the billing→visibility path is the first user-observable one), alert on it in Phase 10. This is one histogram, not a project.

## 1.14 Summary of Document 1

| #    | Finding                                    | Severity | Act when                                     |
| ---- | ------------------------------------------ | -------- | -------------------------------------------- |
| 1.2  | Phone recycling breaks history-claim model | Critical | MM-DEC rev03 before Phase 7                  |
| 1.3  | Mobile/tRPC contract drift                 | High     | ADR by Phase 8 end                           |
| 1.4  | Single-Postgres concentration              | High     | Trigger dashboards in Phase 10               |
| 1.5  | API+worker in one process                  | High     | `ROLE` switch in Phase 6/7; split on trigger |
| 1.6  | PII in immutable event payloads            | High     | Policy in Phase 6 ADR                        |
| 1.7  | ckb/ar search normalization                | Medium   | Verify now; fix before Phase 8               |
| 1.8  | No caching strategy                        | Medium   | ADR + interface at Phase 8 start             |
| 1.9  | directory god-module drift                 | Medium   | Sub-slice discipline now; split on trigger   |
| 1.10 | Data residency unsolved                    | Watch    | ADR before country #2                        |
| 1.11 | No organization entity                     | Watch    | ADR by Phase 8 end                           |
| 1.12 | Better Auth dependency risk                | Watch    | Pin + test-suite discipline                  |
| 1.13 | No eventual-consistency SLO                | Watch    | Metric from Phase 6                          |

---

# Document 2 — Technical Debt Forecast

Debt is predicted, not observed. Each entry: what accrues, why, the milestone at which paying it becomes cheaper than carrying it.

## 2.1 Two-year horizon (through launch + first year)

| Debt                                                                       | Why it accrues                                                                                                                                                                                                                                                                                           | Pay-down milestone                                                                                                                                                                             |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Outbox / pg-boss / notification_log / clinical_access_log table growth** | Append-heavy tables with no partitioning; audit log is _deliberately_ undeletable. **Accelerated (ADR-0010):** the inter-phase clinical extension adds per-row `prescriptions_read` audit logging on every history read, raising `clinical_access_log`'s growth rate above the original Phase 5 baseline | Time-partition when any table crosses ~10M rows or vacuum pressure shows (§9.2) — see §9.2's revised guidance to design `clinical_access_log`'s partition scheme now rather than "while small" |
| **Expo SDK churn**                                                         | Expo majors land ~2×/year; each drags Reanimated/NativeWind/Router peer bumps                                                                                                                                                                                                                            | Budget one maintenance session per Expo major; never upgrade mid-phase                                                                                                                         |
| **Zod v4 / tRPC v11 major migrations**                                     | Both are contract-layer — a major touches every module's schemas                                                                                                                                                                                                                                         | Pin; migrate only in a dedicated hardening window with the contract test suite as the safety net                                                                                               |
| **i18n catalog sprawl**                                                    | Three flat JSON files grow monotonically; keys go stale as UI changes                                                                                                                                                                                                                                    | Adopt per-module key namespaces now (free); add an unused-key linter by Phase 8                                                                                                                |
| **Seed pipeline drift**                                                    | 1,466 ported lines adapted per-phase; each schema change ages it                                                                                                                                                                                                                                         | Treat seeds as code under the same DoD — a schema PR that breaks seeds is red                                                                                                                  |
| **Frozen-contract snapshots** (§1.3)                                       | Each release adds a pinned snapshot                                                                                                                                                                                                                                                                      | Prune snapshots older than the minimum supported app version                                                                                                                                   |
| **AI-generated convention drift**                                          | High-volume agent output slowly normalizes small deviations (naming, error shapes) into precedent                                                                                                                                                                                                        | Monthly sampled human read (Document 12) + boundaries meta-tests keep drift mechanical, not cultural                                                                                           |

## 2.2 Five-year horizon

| Debt                               | Why                                                                                           | Pay-down                                                                                                                       |
| ---------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **directory module size** (§1.9)   | Feature gravity: everything public touches directory                                          | Split into `directory` + `taxonomy` (+ possibly `promotions`) along the sub-slice seams — cheap _if_ §1.9 discipline held      |
| **Search on Postgres**             | Trigram CPU cost grows superlinearly with corpus + query volume; multilingual quality ceiling | Meilisearch adapter (already the planned exit); the §1.7 normalizer ports as-is                                                |
| **Reporting queries on OLTP**      | Admin/finance reporting creep — every dashboard query someone "just adds"                     | Read replica first; CDC → warehouse when replica lags or queries exceed replica capacity (§9.6)                                |
| **Single-region assumption**       | Country #2/#3 with residency rules                                                            | Cell deployment ADR (§1.10)                                                                                                    |
| **Notification cost & complexity** | WhatsApp/SMS pricing changes, template review cycles (Meta), channel preferences matrix       | Preference center is Phase 7; the debt is _template governance_ — keep templates in one reviewed catalog, never inline in code |
| **Session table hot-spot**         | Per-request session reads at growing MAU                                                      | Short-TTL in-process cache (§1.8 layer 2); Redis-backed only when horizontal                                                   |

## 2.3 Ten-year horizon

| Debt                                   | Why                                                                                                                                                  | Pay-down                                                                                                                                           |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Module extraction pressure**         | If any module's team/traffic/compliance profile diverges hard (most likely: clinical — compliance; search — traffic; communication — cost isolation) | Extraction is credible _only if_ convention #1 + boundaries lint held for a decade — this is why F-01-class failures are existential, not cosmetic |
| **Postgres major-version treadmill**   | PG16 → PG20+; extensions (pg_trgm) and Supabase hosting policy set the pace                                                                          | Annual review item; migrations discipline (drizzle-kit + hand SQL in strict sequence) is the asset that keeps this routine                         |
| **Better Auth or successor migration** | Decade-long life of any auth library is uncertain                                                                                                    | Sessions/users in own tables + full auth integration suite = migration is a project, not a crisis                                                  |
| **FHIR/interop mapping layer**         | Insurance + government integrations will demand HL7 FHIR                                                                                             | Facade module translating internal clinical schema ↔ FHIR resources (§8.5); internal schema stays free                                             |
| **Event archive**                      | Decade of domain events = the de-facto system of record for "what happened"                                                                          | Decide retention per event family in the §1.6 ADR; archive to cold storage with the PII-minimized payloads making retention legally safe           |

## 2.4 Refactoring milestones (predicted, gate-triggered like everything else)

1. **Worker split** — trigger: outbox lag p95 > 30s (§1.5). Effort: hours.
2. **Table partitioning** — trigger: §9.2 thresholds. Effort: days per table, one migration window.
3. **Directory/taxonomy split** — trigger: §1.9. Effort: 1–2 weeks if sub-slices held.
4. **Meilisearch adoption** — trigger: search p95 or multilingual quality complaints. Effort: adapter + reindex pipeline, ~2 weeks.
5. **Read replica for reporting** — trigger: reporting load visible on primary. Effort: days.
6. **Cell deployment** — trigger: residency-bound country. Effort: months; the only "big one", and it is deferred correctly.

---

# Document 3 — AI Engineering Constitution

**Status target:** permanent. This document consolidates and, on approval, supersedes the MM-ARC-001 draft. CLAUDE.md remains the in-repo operational instrument; this constitution is its rationale layer and extends it. Precedence: MM-PLAN-001 §3 > CLAUDE.md > this document > any session instruction.

## 3.1 Architecture principles

1. **The monolith is modular or it is worthless.** Every other property (testability, extraction, AI-safety) derives from module isolation. Convention #1 is the constitution's first law.
2. **Consistency is classified, never assumed.** Money and health are strongly consistent (single tx, unique indexes). Discovery and messaging are eventual (outbox). A feature that doesn't state its class isn't designed yet.
3. **Contracts outlive code.** Zod schemas in `packages/contracts` (procedures, events, errors) are the only shared truth. Events and mobile-consumed procedures are additive-forever (breaking = new version/name).
4. **Guardrails are code with meta-tests, never prose.** A rule that cannot fail CI does not exist. Every lint rule, RLS policy, and invariant ships with a test proving it _fires_ (MM-QA-001's core lesson; HANDOFF convention #14).
5. **Adapters own vendors; domains own truth.** Domain and module code import interfaces from `packages/platform` only. Vendor names appear only in adapter implementations and the composition root.
6. **Config over code** for anything a market launch changes: countries, categories, gateways, channels, pricing.
7. **Boring wins.** Postgres before Redis, monolith before services, one adapter before two. New infrastructure requires a trigger that has actually tripped, recorded in an ADR.

## 3.2 Module boundaries

- Modules: `identity · directory · scheduling · booking · clinical · billing · communication · search · ai · admin`. Kernel is shared infra only (outbox, event bus, authz, config, errors, otel) — kernel never imports module internals.
- A module owns its tables exclusively. Cross-module **write** = domain event. Cross-module **read** = the owning module's published query functions or a dedicated read view. Raw cross-module joins in command code are forbidden — including "just this once" in admin code.
- Type-only imports across modules are permitted; value imports are not (enforced by `eslint-plugin-boundaries` v7 config + its meta-test).
- New module criteria: owns data no existing module owns, has its own lifecycle events, and would plausibly extract alone. Otherwise it's a sub-slice.

## 3.3 Naming conventions

- **Events:** `module.past_tense_fact.vN` — `booking.cancelled.v1`, `billing.tier_payment_recorded.v1`. Events are facts, never imperatives (`send_notification` is not an event).
- **Commands:** imperative verb-noun — `cancelAppointment`, `recordTierPayment`. **Queries:** `get*/list*/search*`. tRPC procedures mirror their command/query names.
- **Tables:** snake_case plural, owned-module prefix unnecessary (ownership is by schema file location, enforced by lint). **Columns:** snake_case; timestamps `*_at`; foreign keys `*_id`; money columns carry currency in name or a paired column (`amount_iqd`).
- **Error codes:** SCREAMING_SNAKE in `contracts/errors`, stable forever, never reworded semantically.
- **Files:** kebab-case; one aggregate's commands per file; tests colocated `*.test.ts`.

## 3.4 Folder organization

Per MM-PLAN-001 §2 exactly. Per module: `commands/ · queries/ · events/ · router.ts · schema.ts`. Pure logic lives in `packages/domain/<area>` and never imports db/network/env. Anything with I/O lives in a module or an adapter — no exceptions "for convenience."

## 3.5 Dependency rules

- Allowed direction: `apps/* → packages/*`; `modules → kernel, contracts, domain, platform(interfaces), config, db(client)`; `kernel → contracts, db, platform(interfaces)`.
- Forbidden: module → module (value), kernel → module, domain → anything with I/O, any code → concrete adapter (composition root excepted), clients → `@mesomed/api` value imports (type-only).
- Every dependency a package uses is declared in its own package.json (no phantom deps despite hoisting — lint-enforced).
- New third-party dependency = justification line in the PR: what it replaces, why not stdlib/existing, maintenance signal checked.

## 3.6 Code review expectations (human-over-agent)

- Every diff is reviewed against: the phase's gate criteria, the conventions, and _what the diff didn't do_ (missing tests, missing i18n keys, missing events).
- **Full human read, always:** clinical, billing, identity, authz, migrations, adapters touching secrets. **Sampled read:** everything else (Document 12 sets the rate).
- A PR that touches a locked document's territory without citing it is rejected on that basis alone.
- Agent sessions end with the agent listing deviations it made; undeclared deviation discovered later = audit finding.

## 3.7 Testing philosophy

The DoD (convention #12) verbatim, plus:

- Test _behavior at boundaries_: domain logic pure-unit; commands integration-tested against real Postgres (Testcontainers); routers contract-tested against Zod.
- **Every invariant has a violation test** (double-booking test _attempts_ the double booking).
- **Every guardrail has a meta-test** (lint fixture that must fail; RLS raw-connection test that must be denied; webhook with bad signature that must 401).
- Flaky test = red gate. Quarantine-and-forget is forbidden; a widened timeout gets a code comment + ADR note (per the Phase 3 outbox-drain precedent).
- Coverage numbers are not a goal; untested invariants are the defect.

## 3.8 Performance philosophy

- Budgets are gates: directory p95 < 100ms @ 200k rows; Lighthouse ≥ 90; outbox lag p95 ≤ 10s. A feature ships inside the budget or the budget change is an ADR.
- Measure with EXPLAIN ANALYZE at synthetic scale _before_ shipping query shapes (the perf-explain pattern from rev01 is precedent).
- Keyset pagination only for public lists; OFFSET is forbidden on unbounded tables.
- No speculative optimization: cache/index/denormalize when a measurement says so, and record it.

## 3.9 Security philosophy

- Two-layer authz on every procedure: kernel role guard + in-handler ownership check. A procedure without both is incomplete, not "internal."
- Least privilege everywhere: app DB role is not owner; adapters get scoped keys; CI tokens read-only by default.
- Clinical data: append-only audit via DB trigger, amendments never updates, admin access only via time-boxed grants, deny-all RLS backstop on `encounters`/`visit_notes`/`prescriptions` (scope amended by ADR-0010; mirrors CLAUDE.md convention #6 wording).
- Secrets never in repo, never in logs, never in event payloads. PII minimized in events (§1.6), never in URLs, never in error messages.
- Every external input crosses a Zod schema at the edge (procedures, webhooks, headers used for logic).
- Abuse is a design input: any endpoint that sends money-costing messages (OTP, WhatsApp) ships with rate limits + destination controls on day one.

## 3.10 Database philosophy

- Drizzle schemas per module are the source of truth; migrations are generated + reviewed, hand-SQL for Postgres-specific constructs (triggers, RLS, partitioning), applied in strict sequence, never edited after merge.
- Constraints in the database, not just the app: unique indexes, FKs, checks. The double-booking partial unique index is the exemplar — the DB is the last line of the strong-consistency promise.
- No destructive migration without a reversible plan and a backup verification in the same window.

## 3.11 API philosophy

- tRPC is the only transport until a real external consumer exists; then REST/OpenAPI is a _new transport over the same commands/queries_, never a second business-logic path.
- Procedures are thin: validate (Zod) → authz → command/query → map errors. Business logic in a router is a defect.
- Errors: typed codes only; clients switch on codes; messages are for humans and are localizable, never parsed.

## 3.12 UI philosophy

- Web and mobile are thin: fetch, render, navigate. A conditional that encodes a business rule belongs in the API.
- i18n from day one, all three locales in the same PR that adds a string; RTL via logical properties only; ckb is the default and the first thing visually checked.
- Design tokens from `packages/ui-tokens` are the only source of brand values; hex codes in components are a lint error.
- Loading, empty, error states are part of "done" for every screen.

## 3.13 Refactoring philosophy

- Refactors are trigger-driven (Document 2 §2.4), scoped, and gated like phases: green before, green after, ADR if a boundary moved.
- Never refactor and add behavior in the same PR. Never "improve while passing through" inside clinical/billing/identity.

## 3.14 Documentation standards

- ADR per phase and per triggered decision; ADR numbering confirmed against `docs/adr/` on disk before writing (numbering-divergence precedent is recorded in MM-PLAN-001 §6).
- Locked docs are amended by revision (rev02 → rev03), never silently contradicted; every amendment carries a change note.
- Code comments explain _why_ (the globalThis-emitter comment in rev01 is the exemplar); _what_ belongs in names and types.

## 3.15 Forbidden patterns

`any` / `ts-ignore` / `ts-expect-error` without linked issue · cross-module value imports · raw cross-module joins in commands · barrel-file cycles · business logic in clients or routers · UPDATE on visit-note content or any audit row · secrets or PII in logs, events, URLs · OFFSET pagination on unbounded sets · hardcoded user-facing strings · hardcoded country/category branching (`if country === 'IQ'`) · direct `process.env` reads outside the env schema · vendor SDK imports outside `packages/platform` implementations · silent catch blocks · widening a timeout to make a test pass without a recorded reason · speculative second adapters · `origin: true` CORS · disabling a lint rule inline without a linked ADR/issue.

## 3.16 Required patterns

Zod at every boundary · outbox row in the same transaction as the mutation · idempotency keys on anything replayable (webhooks, payments, notification sends) · typed error mapping · keyset cursors · logical CSS properties · adapter interfaces + composition-root wiring · SECURITY DEFINER trigger for clinical audit · time-boxed grants for admin clinical access · meta-test per guardrail · ADR per deviation.

## 3.17 Good vs bad architecture, by example

**Good:** billing records a tier payment → same tx writes `tier_payments` + outbox `billing.tier_payment_recorded.v1` → directory's subscriber flips a visibility read-model flag. Directory code never changed; billing never touched directory tables.
**Bad:** billing command UPDATEs `facilities.visible` directly ("it's one line"). It works, ships, and quietly deletes the module boundary — the next agent session sees the precedent and copies it. One line of convenience costs the extraction story.

**Good:** the AI triage pipeline — red-flag pre-screen runs unconditionally, LLM behind `AiGateway`, output Zod-parsed and intersected with a DB whitelist, deterministic fallback, no request text logged.
**Bad:** trusting LLM output shape, logging raw symptom text, or letting the model return free-text specialties rendered directly to users.

## 3.18 How an AI agent must think before writing code

1. Which module owns this? If two, the design is wrong or an event is missing.
2. Command or query? What consistency class? What events emit, in which tx?
3. Which conventions (by number) constrain this? Which locked doc governs it? Any conflict → stop, surface, don't route around.
4. What are the invariants, and what test _violates_ each one?
5. What is the abuse case? What is the failure mode when the adapter/vendor is down?
6. i18n keys, all three locales? Error codes typed? PII touched — minimized?
7. Does this create a guardrail? Then where is its meta-test?
8. What am I deviating on? Say it out loud in the session summary; it goes in the ADR.
9. Stop at the phase boundary. Never chain phases.

---

# Document 4 — Architecture Decision Review

Each locked decision, reviewed independently. Verdicts: **Keep** (unchanged), **Keep+Watch** (unchanged, trigger recorded), **Revisit-at** (a named milestone). Risk = cost if the decision turns out wrong; Confidence = that it won't.

| Decision                                                                                                                           | Why it is good                                                                                | Weaknesses                                                                                                | Alternatives considered                                                                                              | Verdict                                                      | Risk                     | Confidence                       |
| ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------ | -------------------------------- |
| **Event-driven modular monolith**                                                                                                  | Service-grade boundaries, monolith-grade ops; matches solo+AI team; extraction path preserved | Boundary enforcement is all lint + discipline — one inert guardrail (F-01) nearly proved the failure mode | Microservices (rejected — ops tax), plain monolith (rejected — 10-yr entanglement)                                   | **Keep**                                                     | High if boundaries rot   | High                             |
| **Pragmatic CQRS + transactional outbox**                                                                                          | Honest consistency classes; audit-friendly; no event-sourcing complexity                      | Outbox is DB churn (§1.4); consumers add operational surface; lag is user-visible without an SLO (§1.13)  | Event sourcing (rejected, correctly), synchronous-only (loses decoupling)                                            | **Keep**                                                     | Medium                   | High                             |
| **Fastify + tRPC v11 single BFF**                                                                                                  | Type-safety end-to-end, zero contract ceremony, transports swappable later                    | No versioning story vs mobile (§1.3); tRPC majors are contract-layer migrations                           | REST+OpenAPI (more ceremony, weaker types), GraphQL (cost without a consumer)                                        | **Keep+Watch** — §1.3 ADR is mandatory                       | Medium                   | High                             |
| **Better Auth (Drizzle adapter, sessions in PG)**                                                                                  | Library not service; two credential strategies on one instance; data in own tables            | Young project (§1.12); session table hot-read                                                             | Supabase Auth (doesn't match MM-DEC, service lock-in), Lucia (deprecated direction), custom (crypto self-build — no) | **Keep+Watch**                                               | Medium                   | Medium-High                      |
| **pg-boss over Redis/queue**                                                                                                       | One infra dependency; native outbox fit; retries/DLQ built-in                                 | Polling latency floor; shares PG resources (§1.4/§1.5)                                                    | BullMQ+Redis (new infra), SQS (vendor lock, latency)                                                                 | **Keep+Watch** — worker-split + lag triggers                 | Low                      | High                             |
| **PostgreSQL 16, Supabase-hosted, infra-only**                                                                                     | Managed PG without SDK lock-in; PITR; exit = any Postgres                                     | Single instance concentration (§1.4); Supabase pricing/policy drift                                       | Self-managed PG (ops burden), RDS/Neon (equivalent — this is the exit hatch, which proves the decision safe)         | **Keep**                                                     | Low (portable by design) | High                             |
| **Drizzle ORM**                                                                                                                    | Team knowledge carried; SQL-proximate; good migration story                                   | drizzle-kit is still fast-moving; complex SQL falls back to hand-written (fine)                           | Prisma (heavier runtime, migration lock-in), Kysely (no schema-as-truth)                                             | **Keep**                                                     | Low                      | High                             |
| **Postgres FTS + pg_trgm behind SearchAdapter**                                                                                    | Zero new infra; adapter exit ready                                                            | Multilingual quality ceiling, esp. ckb (§1.7); CPU cost growth                                            | Meilisearch now (premature infra), Typesense/ES (same)                                                               | **Keep+Watch** — normalizer required; Meilisearch on trigger | Medium                   | High                             |
| **Clinical-tier RLS only (full-schema rejected)** — scope amended by ADR-0010: `encounters`, `visit_notes` → **+ `prescriptions`** | Empirically grounded; defense-in-depth where it counts; no false assurance                    | RLS backstop must itself stay meta-tested or it becomes the thing it replaced                             | Full-schema RLS (proven failure), no RLS (loses backstop)                                                            | **Keep** — do not relitigate                                 | Low                      | High                             |
| **Vercel (web) + Railway/Fly Docker (API)**                                                                                        | Right-tool split; Dockerfile = portability                                                    | Two platforms to operate; egress between them; Vercel cost curve at scale                                 | Single platform (couples web to API host), K8s (absurd at this scale)                                                | **Keep**                                                     | Low                      | Medium-High                      |
| **Expo + EAS for mobile**                                                                                                          | Fastest path to both stores for a solo builder; OTA updates                                   | SDK churn tax (§2.1); native-module limits; store-review latency drives §1.3                              | Bare RN (more control, more cost), Flutter (splits the TS contract story), native ×2 (no)                            | **Keep**                                                     | Medium                   | High                             |
| **Vercel AI SDK behind AiGateway, Anthropic default**                                                                              | Provider swap = config; deterministic fallback preserved                                      | SDK abstraction lags provider features; prompt-injection surface is forever                               | Raw fetch (rev01 pattern — fine but re-per-provider), LangChain (complexity)                                         | **Keep**                                                     | Low                      | High                             |
| **Trilingual ICU catalogs, ckb default, RTL logical properties**                                                                   | Market-correct; retrofit pain avoided by day-one rule                                         | ckb tooling ecosystem is thin (fonts, spell-check, search — §1.7)                                         | en-first + retrofit (the known disaster)                                                                             | **Keep**                                                     | Low                      | High                             |
| **Manual payment gateway at launch; FIB/ZainCash post-launch**                                                                     | Matches market reality (cash/agent payments); orchestrator seam ready                         | Manual = admin toil + fraud surface shifts to admin process                                               | Launch-blocking gateway integration (schedule risk for unproven demand)                                              | **Keep**                                                     | Low                      | High                             |
| **No Redis / no Meilisearch / no microservices / no event sourcing at launch**                                                     | Every deferral has a named trigger and an exit seam                                           | Triggers must actually be monitored (Phase 10 dashboards)                                                 | —                                                                                                                    | **Keep**                                                     | Low                      | High                             |
| **Phone-keyed patient identity + OTP claim (MM-DEC rev02)**                                                                        | Friction-free booking is the right market call; continuity model is sound _except_ recycling  | §1.2 — recycling breaks the "OTP = owner of history" equivalence                                          | Mandatory accounts (kills conversion), email-keyed (emails are rarer than phones in-market)                          | **Revisit-at MM-DEC rev03, before Phase 7**                  | High until amended       | High that the amendment fixes it |

---

# Document 5 — Long-Term Scalability Review

Assumption set: 10M registered users, 3–5 countries, ~10k providers, ~5M appointments/yr (~15–20k/day, peak ×5), heavy AI triage, notification fan-out on every booking event.

## 5.1 Database (the binding constraint, by design)

- **Working set:** appointments at 5M/yr are small rows — tens of GB over years; PG handles this trivially _if_ partitioned per §9.2 and indexed as validated. Not the bottleneck.
- **Connections:** 10M users ≠ 10M connections, but API horizontal scale × pool size will exceed PG limits long before query capacity does. **pgbouncer (transaction mode) is the first scaling action** — cheap, invisible to Drizzle, trigger at 60% connection saturation.
- **Write hot spots:** the double-booking partial unique index serializes only per doctor-slot — correct and naturally sharded by doctor. Sessions and outbox are the real write-churn tables; both are cache-able / partition-able respectively.
- **Verdict:** a single well-tuned PG16 + pgbouncer + read replica carries this assumption set. The cell model (§1.10) is the geographic scale-out, not sharding.

## 5.2 Outbox / jobs

- 20k bookings/day × ~4 events × subscribers ≈ low hundreds of thousands of job executions/day — comfortably within pg-boss on adequate hardware, _if_ workers are split from the API (§1.5) and completed-job retention is aggressive.
- Dead-letter depth and dispatch lag are the two metrics that predict trouble weeks early. Alert on both (Phase 10).
- Exit if ever needed: pg-boss → Redis/BullMQ swap is contained in the kernel dispatcher; module code never sees it.

## 5.3 API layer

- Fastify + tRPC is not the bottleneck at any plausible scale; Node horizontal scale behind a load balancer is routine _because_ the app is stateless (sessions in PG, no in-process state that matters — the in-memory rate limiter is the one exception and already has a documented Redis exit).
- Watch: per-request session read (cache, §1.8) and tRPC batch endpoints as an amplification surface (§6.7).

## 5.4 Search

- Trigram at 200k facilities is validated; at 10× listings + real query volume, CPU cost and multilingual quality both argue for the Meilisearch trigger tripping around country #2–3. The adapter seam + §1.7 normalizer make this a re-index project, not a rewrite.

## 5.5 Notifications

- Fan-out is the largest _external_ rate constraint: Meta WhatsApp throughput tiers, template approval latency, and per-message cost. Architecture already right (queue + retry + idempotency); add per-channel circuit breakers and a spend budget guard (§6.6). Push (free) displacing WhatsApp (paid) as app adoption grows is the cost curve's natural fix — instrument channel mix from Phase 7.

## 5.6 AI

- Triage is stateless per-request with an 8s timeout and deterministic fallback — horizontally trivial. The constraints are provider rate limits and cost per call: cache-by-normalized-input is _not_ recommended (medical text, privacy) but the red-flag pre-screen + keyword fallback already shed load. Budget alerting per §6.6 applies.

## 5.7 Web / mobile / media

- Next.js on Vercel scales with money; the risk is cost, not capacity — watch image-optimization invocation pricing and put media behind CDN-cached storage URLs (Supabase transform endpoint already does this).
- Mobile scale pressure appears as API compatibility (§1.3) and push-token volume (trivial), not throughput.

## 5.8 Background growth

- Cron-style jobs (reminders) grow linearly with appointments — fine. The pattern to forbid early: unbounded per-row cron scans; every scheduled job queries by indexed time window (the rev01 reminder script already models this correctly).

## 5.9 Bottleneck ranking at the assumption set

1. PG connections (pgbouncer — trivial fix, must be pre-planned)
2. WhatsApp/SMS throughput + cost (external, managed by channel mix + budget guards)
3. Search CPU + quality (Meilisearch trigger)
4. Worker/API contention (split trigger, §1.5)
5. Everything else is money, not architecture.

---

# Document 6 — Security Review

Architecture-level only (implementation bugs are the audit program's job, Document 12). Ordered by expected loss.

## 6.1 Medical-data exposure class (highest stakes)

The clinical design is strong: append-only DB-trigger audit, amendments-not-updates, time-boxed admin grants, deny-all RLS backstop. Architectural additions:

- **The audit chain itself is the crown jewel.** Its integrity guarantee is "no UPDATE/DELETE policy + trigger" — verify per release (meta-test exists per Phase 5 gate) _and_ protect it at the backup layer: audit tables in every backup, restore drill checks them (Document 10).
- **Erasure vs immutability:** the crypto-shred design (Phase 10) must cover clinical amendments, event payloads (§1.6), notification logs (which carry phone + appointment linkage), and backups (key destruction covers backups by construction). **Scope addition (ADR-0010, inter-phase clinical extension):** `prescriptions` (medication content), `patient_medical_profile` (allergies, blood type), and `patient_reported_medications` now enter erasure scope, plus the `clinical_access_log.prescription_id` linkage column. Make key management its own ADR — this is the mechanism the entire privacy story hangs on.

## 6.2 Identity risks

- **Phone recycling** — §1.2. The single largest architectural identity risk; fix in MM-DEC rev03.
- **Account takeover economics:** patient auth = phone + password with OTP only at registration/recovery. Recovery via WhatsApp OTP inherits SIM-swap risk — acceptable in-market, but recovery events must be audited, notify secondary channels when present, and rate-limit hard.
- **Provider accounts** gate public trust (verified badge, clinical access). Admin manual recovery is a social-engineering surface: require dual evidence recorded in the audit event (already an "audit event" per Phase 2 — keep it strict).
- **Session model:** persistent until revoked (MM-DEC §4) is a product choice with a security cost; the compensations are device/session listing + revocation (planned) and re-auth on sensitive transitions — add "step-up before viewing clinical records on a session older than X" to the Phase 9 design space (product decision, flag it now).

## 6.3 Authorization risks

- Two-layer authz is sound; its failure mode is the _forgotten second layer_ — a handler with a role check but no ownership check. Mitigation is mechanical: a contract-test convention that every command's test suite includes an authz-denial case (already convention #12) **plus** a lint/CI check that every mutation procedure references the ownership helper. Make the ownership check un-forgettable, not just expected.
- Admin is the super-surface: taxonomy, tiers, verification, subscriptions, support-access. Admin actions should emit events (audit trail) uniformly — adopt "every admin mutation emits `admin.*` or the owning module's event" as a convention in the Phase 6 ADR (billing admin actions are the first big batch).

## 6.4 API abuse

- Public, unauthenticated surfaces: directory search, symptom triage, guest booking, OTP request. Each needs its own rate-limit budget and shape validation (all planned) — plus **enumeration control**: guest booking must not confirm whether a phone number already has a profile (response uniformity), and directory queries must not expose non-visible providers via parameter manipulation (the visibility predicate lives in the query, tested with negative fixtures — port the rev01 negative-fixture habit).
- Webhook endpoints: signature verification is interface-level in Phase 6 — the _gate_ must include a bad-signature 401 test and replay rejection via the idempotency tuple.

## 6.5 Event/data-layer privacy

- §1.6 (PII-minimized payloads) is the structural fix. Add: log redaction as a pino serializer at the kernel level (phone/name fields folded at the logging seam, not by per-callsite discipline).

## 6.6 Financially-costed abuse (OTP pumping / notification abuse)

- SMS/WhatsApp toll fraud (artificially inflated traffic) is a _when_, not _if_, for any public OTP endpoint in this region. Architectural requirements for Phase 7's gate: per-phone + per-IP + per-device rate limits, destination-country allowlist as a config table (convention #9 — Iraq-only at launch), velocity anomaly alerting, a global channel kill-switch, and a daily spend budget alarm. None of this is optional; the cost incidents are unbounded otherwise.

## 6.7 AI abuse

- Existing pipeline mitigations (delimiting, whitelist intersection, output schema, no free-text rendering, no request logging) are the right shape — keep them as _required patterns_ (§3.16-adjacent) for every future AI feature, not just triage. Add: per-user/IP quota separate from the global rate limit, and treat any future AI feature that can _write_ (drafting, summaries into records) as a new threat-model exercise — generation into clinical records is a different risk class than routing and needs its own ADR before it is ever scoped.

## 6.8 Payments

- Manual gateway: the fraud surface is the admin process (fake payment recorded → visibility granted). Compensations: admin payment events audited (6.3), idempotency constraints (exist), and a monthly reconciliation report (payments vs bank/agent records) as an operational control, not code.
- FIB/ZainCash later: signature verification, amount/currency verification against the order (never trust webhook amounts), and replay rejection are the three gate criteria to pre-write into the go-live ADR now.

## 6.9 Multi-tenant future

- Today: no tenants, no risk. When organizations land (§1.11), the classic failure is org-scoping applied in queries but forgotten in one command — the §6.3 mechanical-ownership-check pattern is the pre-mitigation. Record in the org ADR.

## 6.10 Platform/supply chain

- Phase 10 already plans npm audit + Dependabot + CodeQL + secret scanning; pull **secret scanning and dependency audit into CI now** (they are one workflow line each and Phase 6–7 is when secrets multiply). Pin GitHub Actions by SHA at Phase 10 per MM-QA-001 F-09e.

---

# Document 7 — Performance Review

Per layer: current posture → risk → recommendation. Budgets restated from the plan are gates, not aspirations (§3.8).

| Layer                       | Posture                                                                                                                       | Risk                                                                      | Recommendation                                                                                                                                                                                |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Database**                | Keyset pagination ported; trigram + partial keyset indexes validated at 200k synthetic rows; partial unique index for booking | Index drift as queries evolve; vacuum churn tables (§1.4)                 | Re-run the perf-explain harness whenever a directory/search query shape changes (make it a checklist item, it already exists as tooling); pg_stat_statements reviewed quarterly (Document 12) |
| **Search**                  | FTS+trigram, adapter seam                                                                                                     | Multilingual quality (§1.7); CPU growth                                   | Normalizer now; Meilisearch on trigger; measure zero-result rate per locale as the quality metric                                                                                             |
| **API**                     | Fastify (fast), thin procedures                                                                                               | N+1 patterns inside queries as feeds get richer; tRPC batch amplification | Feed queries built as single SQL with joins/lateral, never per-item loops — review in Phase 8; cap batch size in tRPC config                                                                  |
| **Events/queue**            | Outbox + pg-boss, retry/DLQ                                                                                                   | Lag under fan-out (§1.13); worker contention (§1.5)                       | Lag SLO p95 ≤ 10s; worker split trigger; completed-job retention short                                                                                                                        |
| **Caching**                 | Undefined                                                                                                                     | Phase 8 improvisation                                                     | §1.8 three-layer strategy; CDN `s-maxage` on public pages is the highest-leverage single change                                                                                               |
| **Web**                     | Lighthouse ≥ 90 gate; next/font + real image pipeline planned (fixes rev01 `unoptimized` regression)                          | Vercel image-optimization cost; RSC payload bloat on feed pages           | Remote patterns configured (Phase 8); measure feed-page payload size as part of the Lighthouse gate                                                                                           |
| **Mobile**                  | TanStack Query, offline-tolerant browsing gate in Phase 9                                                                     | Cold-start weight (Expo), image lists                                     | Cache-first query config for directory reads; FlashList-class virtualization for feeds; EAS Update to keep JS bundle lean                                                                     |
| **Background jobs**         | Reminder cron windowed by indexed time                                                                                        | Unbounded scans creeping in                                               | Forbidden-pattern rule (§5.8)                                                                                                                                                                 |
| **Storage/media/CDN**       | Supabase transform endpoint with width presets                                                                                | Origin egress cost, transform latency                                     | Ensure transform URLs are CDN-cached (they are, via Supabase CDN) and immutable-cacheable (versioned paths); revisit only if media volume jumps                                               |
| **Future scaling sequence** | —                                                                                                                             | —                                                                         | pgbouncer → worker split → read replica → CDN/cache tightening → Meilisearch → cells. In that order; each has a named trigger                                                                 |

---

# Document 8 — Product Architecture Review

Question: does the locked architecture _absorb_ each future product line without rework? Verdict per line: **Absorbs** (new module(s), no structural change) / **Absorbs with ADR** (needs a recorded decision first) / **Structural** (would change the architecture — flagged early).

## 8.1 Future healthcare services (home nursing operations, lab orders, pharmacy fulfillment)

**Absorbs.** Each is a vertical slice with its own aggregate + events (`labs.order_placed.v1`, `nursing.visit_scheduled.v1`), consuming identity/directory via published queries. The booking state-machine pattern generalizes (a lab order is a lifecycle, like an appointment). Precondition: convention #1 held.

## 8.2 Telemedicine

**Absorbs with ADR.** Video is a vendor problem (Twilio/Daily/Agora/LiveKit) behind a `VideoChannel` adapter — classic convention #8. The architectural decisions to make in the ADR: session tokens minted server-side per appointment, recording policy (default **off**; if ever on, recordings are clinical data → audit + retention + crypto-shred scope), and telemedicine appointments as a booking _type_, not a new module (the state machine gains states, additively).

## 8.3 AI healthcare services beyond triage

**Absorbs with ADR — and this is the one to be strict about.** Routing/triage (read-only, whitelist-constrained) is architecturally safe. Anything that _writes toward the record_ (visit-note drafting, summarization, patient-facing explanations of results) is a new risk class: it needs human-in-the-loop as a domain rule (drafts are drafts until a clinician commits them — which maps cleanly onto the amendments model), provenance marking on AI-assisted content, and its own threat model (§6.7). The `AiGateway` adapter absorbs the vendors; the _domain rules_ are the real work.

## 8.4 Medical marketplace

**Absorbs.** Orders/inventory/fulfillment = 2–3 new modules + PaymentOrchestrator reuse (this is exactly why the orchestrator with a routing config table was the right shape). New concerns arrive with it — pharmacy licensing rules per country (config tables), prescription-gated products (clinical linkage via events) — all expressible in the current model. Defer entirely until scoped.

## 8.5 Insurance integrations

**Absorbs with ADR.** Eligibility-check and claims-submission are adapters per insurer; the structural decision is **interop format**: build a FHIR facade module (internal schema ↔ FHIR R4-ish resources: Patient, Encounter, Coverage, Claim) rather than bending internal schemas toward FHIR. Record the facade strategy as an ADR _before_ the first insurer conversation so internal Phase 5/6 schemas never get warped by an external standard. Also arrives with it: consent management (patient consents to share with insurer X) — a small identity-module extension worth sketching in the same ADR.

## 8.6 Government integrations

**Absorbs with ADR.** Likely shapes: provider-license verification against a registry (directory-module adapter), reporting/notifiable-data feeds (read-model exports), national-ID linkage (identity extension). The FHIR facade (8.5) covers most data-exchange asks. The one to watch is _mandated_ data residency or mandated audit access — both land on §1.10's cell model and the audit chain's exportability. Nothing to build now.

## 8.7 Enterprise customers (hospital groups, employers)

**Absorbs with ADR.** Requires the organization entity (§1.11) + seat/role management + possibly SSO (Better Auth has plugin paths; verify at the time). Billing gains org-level subscription plans — the billing module's schema should keep `subscriptions` polymorphic-capable (subject_type/subject_id rather than doctor-only FK) — **check this against the Phase 6 schema before kickoff; it is a one-column decision now vs a migration later.** This is the single most actionable line in Document 8.

## 8.8 Multi-country

**Absorbs** at app layer (convention #9, proven pattern from rev01's countries/coming_soon). Data layer per §1.10. Additional product-layer readiness already in place: trilingual day-one, config-driven categories, currency handling — verify Phase 6 stores currency explicitly per price row (IQD-only today, but a currency column is free now).

## 8.9 Verdict

The roadmap supports the vision. The three cheap-now/expensive-later items: **(1)** Phase 6 `subscriptions` subject polymorphism + explicit currency column, **(2)** FHIR-facade ADR before insurer talks, **(3)** organization-entity ADR by Phase 8 end. Everything else defers cleanly.

---

# Document 9 — Database Architecture Review

## 9.1 Table organization

Per-module ownership with `packages/db` as re-export hub is correct and carried from a proven rev01 pattern. Keep the rule that migrations are reviewed as part of the owning module's PR — the schema file location _is_ the ownership declaration.

## 9.2 Growth & partitioning strategy

| Table class                                 | Growth                                                                                                                                                                                                                                               | Strategy                                                                                                                                                                                                                                                        |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domain_events` (outbox)                    | Highest churn                                                                                                                                                                                                                                        | Short retention on _dispatched_ rows (archive-then-delete or move to `domain_events_archive`); time-partition (monthly) when > ~10M rows/quarter; completed pg-boss jobs pruned aggressively via its retention config                                           |
| `clinical_access_log`                       | Append-only, undeletable; growth rate revised upward — ADR-0010 (inter-phase clinical extension) adds per-row `prescriptions_read` audit logging on every history read, multiplying write volume beyond the original encounters/visit_notes baseline | **Design the partition scheme now, not "while small"** — promote from Phase 6/7-timed to a firm pre-Phase-7 action item; it can never be pruned, partitioning is the _only_ management tool it will ever have, and the growth-rate revision shortens the runway |
| `notification_log`                          | High                                                                                                                                                                                                                                                 | Retention policy (e.g., 12–24 months) + time-partition; contains PII linkage → in crypto-shred scope                                                                                                                                                            |
| `appointments`, `encounters`, `visit_notes` | Linear, modest                                                                                                                                                                                                                                       | No partitioning foreseeable at assumption-set scale; revisit at 50M+ appointment rows                                                                                                                                                                           |
| Sessions (Better Auth)                      | Churn                                                                                                                                                                                                                                                | Expired-session sweep job from day one (Phase 2 follow-up if absent)                                                                                                                                                                                            |

## 9.3 Index strategy

Validated-at-scale before shipping (perf-explain precedent) — keep as the standing rule. Additions: quarterly `pg_stat_statements` + unused-index review (Document 12); every new query shape on a large table gets an EXPLAIN in the PR description; partial indexes preferred where predicates are stable (the double-booking index is the exemplar).

## 9.4 Soft-delete strategy (currently undefined — define now)

One rule, four classes (revised — ADR-0010, inter-phase clinical extension, established a new precedent that must be reconciled here): **Clinical (doctor-authored) data is never deleted** (amendments + crypto-shred for erasure — e.g. `prescriptions`). **Directory/config entities are deactivated, not deleted** (`active` flags — already the rev01-carried pattern; deactivation preserves referential history for appointments pointing at old facilities). **Patient-authored non-clinical data may hard-delete** (new class — ADR-0010 precedent: `patient_reported_medications.removeReportedMedication` is a genuine hard delete, no audit trail, no amendment model; this is deliberate and distinct from clinical data because the patient owns and controls it directly). **True deletion** otherwise exists only for: drafts never published, and PII under erasure (via crypto-shred, so the row skeleton may remain). No generic `deleted_at` column convention — deactivation/ownership semantics beat tombstone semantics for this domain. Record as a short ADR (one page).

## 9.5 Auditing

DB-trigger clinical audit is the strong path (keep). Application-level audit for admin/billing actions rides the event stream (§6.3) — which makes the outbox archive part of the audit story, another reason for §1.6's PII policy and §9.2's archive-not-delete for events.

## 9.6 Analytics, reporting, warehouse

Phase order: **(1)** launch: admin reporting via the same read models, kept deliberately light; **(2)** first pressure: read replica, all reporting queries pointed there (connection-string-level split — trivial with the client factory); **(3)** real analytics: CDC (logical replication → warehouse; Postgres→ClickHouse or BigQuery via Debezium-class tooling) — _never_ dual-write from application code. The event stream is a bonus analytics source that already exists. Forbidden: BI tools pointed at the primary.

## 9.7 Backup & recovery

Supabase PITR as the base; requirements to codify (Document 10): RPO ≤ 5 min (PITR), RTO target ≤ 4h at launch, **quarterly restore drill** that restores to a scratch instance and runs a verification script (row counts per critical table, audit-chain spot check, latest-migration check). An untested backup is a hope, not a control.

## 9.8 Migration strategy

Current discipline (drizzle-kit generated + hand SQL for triggers/RLS, strict sequence, applied by runner in CI) is right. Additions as the DB grows: expand-migrate-contract pattern for any breaking column change once production data exists (add new → backfill → switch reads → drop old, across releases); never a long-lock DDL in a deploy window without `lock_timeout` set; every destructive migration PR names its rollback.

## 9.9 Future data warehouse considerations

Design nothing now; preserve two cheap options: **(a)** stable event contracts (already law) make event-stream-based analytics possible retroactively; **(b)** avoid jsonb-as-schema for anything reporting will need (jsonb for payloads/config is fine; core business columns stay typed columns). Both are already the trajectory — this section just names them as load-bearing.

---

# Document 10 — Operations & DevOps Strategy

Sized for solo-founder + AI agents now, written to survive a small team later.

## 10.1 Development & branch strategy

- **Trunk-based:** short-lived branches → PR → `main`. No develop branch, no gitflow. `main` is always deployable.
- Branch naming: `phase-N/<slice>` during build-out, `fix/<issue>` after.
- **All work from the WSL clone** (`~/mesomed`); the Windows path is read-only reference (CRLF incident is precedent, recorded here permanently).

## 10.2 Pull requests

- Every change lands via PR, even solo — the PR is the human-oversight instrument for agent output and the audit unit for Document 12.
- Required checks: full CI gate (lint incl. boundaries meta-test, typecheck, unit, integration, contract, build, docker build, format:check, dependency+secret scan). Branch protection on `main` requires them.
- PR template fields: phase/slice, conventions touched (by number), deviations declared, EXPLAIN attached if a large-table query changed, i18n keys confirmed ×3 locales.

## 10.3 Environments

| Env            | What                                                                                                     | Data                          |
| -------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------- |
| **local**      | Full stack via Testcontainers/local PG; mock adapters                                                    | Seed pipeline                 |
| **staging**    | API on Railway/Fly (separate service) + separate Supabase project + Vercel preview + EAS preview channel | Seeded, never production data |
| **production** | Per plan                                                                                                 | Real                          |

Rule: mock adapters cannot be enabled in production — the composition root refuses to boot with a mock adapter when `NODE_ENV=production` (a guardrail, therefore meta-tested).

## 10.4 Secrets management

- Secrets live only in platform stores (Railway/Fly, Vercel, GitHub Actions encrypted secrets, EAS secrets). Repo contains `.env.example` names only.
- Every secret in the Zod env schema (fail-fast); rotation checklist per adapter written when the adapter lands (Phase 7 is when this matters); CI secret-scan from now (§6.10).
- Least-privilege: DB app role non-owner in production (already law); per-adapter keys scoped minimal.

## 10.5 CI/CD & release management

- CI = the gate (10.2). CD: merge to `main` → auto-deploy staging; production deploy is a **manual promotion** of the same artifacts (same Docker image digest, same web build) — never a rebuild.
- Releases tagged `vX.Y.Z`; changelog generated from PR titles; mobile releases ride EAS channels (preview → production), OTA for JS-only, store builds for native changes.
- DB migrations run before app deploy in the promotion pipeline; expand-migrate-contract (§9.8) keeps old code + new schema compatible during the window.

## 10.6 Rollback strategy

- **API:** redeploy previous image digest (immutable images make this one command). **Web:** Vercel instant rollback. **Mobile:** EAS Update republish previous bundle; store builds roll forward only.
- **DB:** migrations roll _forward_ (a new migration undoes), except the destructive ones which pre-declared their rollback (§9.8). PITR is the disaster path, not the routine path.
- Rollback drill: perform one deliberate staging rollback per quarter alongside the restore drill.

## 10.7 Feature flags

- Convention #9's config tables _are_ the flag system: country gates, category enablement, gateway/channel enablement, min-app-version (§1.3), kill switches (§6.6). No third-party flag service. Flags are Zod-validated rows, cached by the config service, changeable without deploy.
- Rule: flags for _operational_ control live forever (kill switches); flags for _rollout_ get a removal date in the PR that adds them.

## 10.8 Monitoring, observability, alerting

- Stack per plan (pino + OTel/OTLP → Grafana Cloud, Sentry). The Phase 10 dashboard set, made explicit: outbox dispatch lag + DLQ depth · booking funnel + booking p95 · directory/search p95 + zero-result rate per locale · error rate by module · notification delivery rate + spend by channel · OTP request velocity · DB: connections, replication lag (when replica exists), dead-tuple ratio on churn tables · uptime probes on `/health` + `/ready`.
- **Alert only on:** outbox lag, DLQ depth, error-rate spike, OTP velocity anomaly, notification spend budget, DB connection saturation, probe failures. Everything else is dashboard, not page — solo operator, alert fatigue is a real availability risk.
- Synthetic probe: a scripted guest-booking against staging hourly and production (against a designated test doctor) daily — the one check that exercises the whole spine.

## 10.9 Incident response & disaster recovery

- Solo-sized runbook, one page per scenario, stored in `docs/runbooks/`: API down · DB degraded · outbox stalled/DLQ growing · notification provider outage (kill switch + queue drains later) · OTP abuse spike (kill switch + allowlist) · suspected data breach (freeze support-access grants, snapshot audit log, rotate keys, notification obligations checklist).
- Severity ladder: SEV1 = booking or clinical write path down; SEV2 = degraded eventual paths (search stale, notifications delayed); SEV3 = cosmetic. Postmortem (blameless, one page) for every SEV1/2 → feeds the risk register.
- DR: RPO/RTO per §9.7; quarterly restore drill; the Dockerfile-portability decision is itself the platform-DR plan (Railway↔Fly↔anything).

## 10.10 Logging / metrics / tracing division

- **Logs** (pino, redacted at the serializer — §6.5): what happened, request-scoped. **Metrics:** rates/latencies/depths for dashboards+alerts. **Traces** (OTel): cross-boundary causality — booking command → outbox → subscriber → notification is the trace that pays for the whole OTel investment; verify it renders end-to-end as a Phase 7 gate check (the span smoke-test habit from the F-03 fix, extended).

---

# Document 11 — Quality Assurance Strategy

The permanent QA system. Convention #12 (per-slice DoD) is the foundation; this document is the full pyramid around it.

## 11.1 Test taxonomy & ownership

| Level           | Tool                                    | Scope                                                                                                                                          | Runs                                                                                    |
| --------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **Unit**        | Vitest                                  | Pure domain logic in `packages/domain` + module pure helpers                                                                                   | Every PR, seconds                                                                       |
| **Integration** | Vitest + Testcontainers / CI pg service | Every command: happy + authz-denial + invariant-violation, against real Postgres; outbox atomicity; subscriber effects                         | Every PR                                                                                |
| **Contract**    | Vitest                                  | Router I/O ↔ Zod schemas; frozen previous-release client snapshot (§1.3); event payload ↔ `contracts/events`; AppError↔TRPC status mapping     | Every PR                                                                                |
| **Meta-tests**  | Vitest/ESLint API                       | Every guardrail fires: boundaries fixture fails lint, RLS raw-connection denied, bad webhook signature 401s, mock-adapter-in-prod boot refused | Every PR                                                                                |
| **E2E web**     | Playwright                              | Guest booking · provider signup→verification→visibility · admin tier payment · auth flows (from Phase 8)                                       | Every PR touching web; full suite nightly                                               |
| **E2E mobile**  | Maestro                                 | Booking · login + persistence · push receipt (from Phase 9)                                                                                    | Pre-release + nightly on EAS preview                                                    |
| **Load**        | k6                                      | Booking + directory at 10× expected traffic                                                                                                    | Phase 10 gate; re-run before any launch-scale event and after major query-shape changes |
| **Security**    | CI scanners + audit program             | npm audit/Dependabot/CodeQL/secret scan (CI); scoped human audits per Document 12                                                              | Continuous + scheduled                                                                  |

## 11.2 Security testing

Three layers: **(1)** CI scanners (continuous, §6.10); **(2)** abuse-case tests written _with_ the feature — every rate limit has a test that exceeds it, every signature check a test that forges it, every enumeration surface a uniformity test; **(3)** scheduled human/agent security audits (Document 12), with one external penetration test before public launch and after any auth-model change (MM-DEC rev03 qualifies).

## 11.3 Performance & regression testing

- Perf budgets are CI-adjacent gates: the directory p95 assertion runs against the seeded 200k dataset in the Phase 3-style harness whenever directory/search queries change (tag those PRs).
- Regression = the whole CI suite; there is no separate regression phase. A production bug's fix always lands with the test that would have caught it — no exceptions, this is how the suite compounds.

## 11.4 Accessibility testing

- Automated: axe-core assertions inside the Playwright suite (Phase 8 onward) — catches the mechanical 60%.
- Manual per release: keyboard-only pass on booking + auth flows; screen-reader spot check (NVDA) on the booking flow; contrast tokens verified once in `ui-tokens` (then inherited everywhere).
- RTL is treated as an accessibility-class concern: see 11.5.

## 11.5 Localization testing

- CI: catalog-completeness check (every key exists in en/ar/ckb — build fails on gaps); unused-key linter (§2.1).
- Visual: Playwright screenshot suite runs in **ckb (RTL) first**, then ar, then en — RTL is the default and gets the most eyes, matching the market. Snapshot diffs reviewed per release.
- Human: a native-reader pass (ckb + ar) on new user-facing surfaces per release — machine checks cannot catch register/tone errors in Sorani.

## 11.6 Manual QA & release readiness

Release checklist (one page, versioned in `docs/`):

1. CI green on the release commit (necessarily true via branch protection)
2. E2E suites green (web; mobile when applicable)
3. Migration dry-run on staging with production-shaped data volume
4. RTL screenshot diff reviewed · localization completeness green
5. Perf budget spot-check if query shapes changed
6. Rollback path identified (previous image digest noted)
7. Runbook updated if new operational surface shipped
8. ADR written if any decision/deviation occurred

## 11.7 Production verification (post-deploy)

- Smoke: synthetic guest-booking probe (10.8) + `/ready` + one directory search per locale, executed automatically after promotion.
- Watch window: 30 minutes on error rate, outbox lag, p95 dashboards after every production deploy; deploys happen at low-traffic hours (Asia/Baghdad mornings mid-week) by default.
- Sentry release tagging on every deploy so regressions attribute to releases automatically.

## 11.8 QA principles (permanent)

- The gate suite is the definition of working software; anything not covered by a gate is an opinion.
- Tests verify the deployable artifact, never a copy of it (F-05 lesson — factory-based tests forever).
- A green checkmark must never overstate coverage (F-09c lesson): missing test scripts fail loudly, silent no-op tasks are forbidden in turbo config.

---

# Document 12 — Audit Strategy

The permanent audit program. Principle: **audits verify that guardrails fire and that reality matches documents** — they are the anti-false-assurance mechanism (MM-QA-001's mandate made permanent).

## 12.1 Audit types & definitions

| Type                       | Verifies                                                                    | Method                                                                                                                             |
| -------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Automated per-PR**       | Conventions mechanically enforceable                                        | CI (lint+meta-tests, types, tests, scans)                                                                                          |
| **Phase-gate self-audit**  | Gate criteria actually demonstrated                                         | Verification output attached to the closing ADR (existing practice)                                                                |
| **Architecture audit**     | Boundaries, plan-conformance, false-assurance hunting                       | Independent MM-QA-style session: fresh context, adversarial, empirically tests claims (fixtures, fake collectors, raw connections) |
| **Security audit**         | Authz completeness, secrets, abuse surfaces, clinical chain                 | Scoped checklist + attack attempts against staging                                                                                 |
| **Performance audit**      | Budgets hold at scale                                                       | Perf harness + pg_stat_statements + k6                                                                                             |
| **Database audit**         | Bloat, unused indexes, slow queries, partition health, backup restorability | Scripted review + restore drill                                                                                                    |
| **Dependency audit**       | CVEs, unmaintained deps, license drift                                      | Scanner output triage                                                                                                              |
| **Debt audit**             | Document 2 forecast vs reality; trigger conditions checked                  | Review of §2.4 triggers against metrics                                                                                            |
| **AI-code audit**          | Agent output quality/drift beyond what CI catches                           | Sampled human deep-read of merged PRs                                                                                              |
| **UX/accessibility audit** | 11.4/11.5 human passes                                                      | Manual per release                                                                                                                 |

## 12.2 Schedule

| Cadence                                 | Audit                                                                                                                                                                  | Justification                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Every PR**                            | Automated                                                                                                                                                              | The only scale-proof layer; everything mechanical lives here or it doesn't exist                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Every phase gate**                    | Self-audit + ADR                                                                                                                                                       | Existing discipline; the ADR is the audit record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Before every mock→real adapter flip** | Scoped security audit (secrets, rate limits, abuse cases, kill switch)                                                                                                 | The moment risk becomes external and financially/PII-costed; Phase 7 (OTP/WhatsApp/SMS) is the first, FIB/ZainCash go-live the second                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **After Phase 7**                       | **Full architecture audit (MM-QA-002)** — cumulative Phases 1–7 **+ inter-phase clinical extension (ADR-0010)**                                                        | First independent audit since Phase 0; before the launch-pressure phases where findings get deferred instead of fixed. Audit-target meta-test inventory grows with ADR-0010: prescription immutability triggers (`prescriptions_guard_update`/`prescriptions_no_delete`), the pinned RLS table set (now `encounters`/`prescriptions`/`visit_notes`), the pinned clinical event-name set (7 events), the authz MATRIX meta-test (+8 procedure entries), and the modified `clinical_audit_row()` function (CREATE OR REPLACE of a Phase-5 artifact is itself an audit target — verify the replace didn't silently alter Phase 5 behavior) |
| **Phase 10 (pre-launch)**               | Security (incl. external pentest) + performance (k6) + DR drill + dependency deep-pass                                                                                 | Launch gate per plan; the pentest is the one thing to buy externally                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Launch + 30 days**                    | Post-release audit: incident review, dashboard-vs-reality check, alert-tuning, debt triage                                                                             | Production teaches what staging cannot; capture it while fresh                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Monthly** (~1h)                       | Dependency triage + AI-code sample: 3–5 merged PRs deep-read; **every** clinical/billing/identity/authz/migration diff gets a full human read at merge time regardless | Drift detection at agent velocity; the sample rate is the knob if drift appears                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Quarterly** (~half day)               | Database audit + restore drill + rollback drill + debt-trigger review + security-posture check (key rotation, access review, secret-scan findings)                     | Matches the decay rate of operational assumptions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Annually**                            | Full architecture review: this package + constitution vs reality; every Keep+Watch decision re-verdicted; risk register re-scored; MM-ARC-002 revised                  | The 10-year horizon is maintained one honest year at a time                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

## 12.3 Audit execution rules

- Architecture/security audits run in a **fresh agent session with independent framing** (the MM-QA-001 pattern): the auditor reads the locked docs + code, trusts no claim, and _tests_ load-bearing assertions empirically. Same model class as planning (Fable-tier), never the session that wrote the code.
- Every audit produces a findings document (MM-QA-00N) with severities, and a blocking list if any finding gates the next phase — findings follow the same gate discipline as phases.
- Audit findings that reveal an inert guardrail are automatically Critical, regardless of current exploitability (false assurance is the defined worst class).
- Closed findings get verification evidence in the closing ADR, not just "fixed."

---

# Document 13 — Risk Register

Living document; re-scored quarterly (Document 12). P/I on 1–5; Score = P×I. Owner is Hakeem for all (solo) — the column records the _hat_: Arch(itecture), Sec(urity), Ops, Prod(uct).

| #   | Risk                                                                                                                                                                                                                                                                                                                                                                                                                     |   P |   I |  Score | Mitigation                                                                                                                                                                                                                                                                    | Early warning signs                                                                                                                                | Hat      | Review                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --: | --: | -----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------ |
| R1  | Phone recycling → stranger claims medical history (§1.2)                                                                                                                                                                                                                                                                                                                                                                 |   3 |   5 | **15** | MM-DEC rev03 step-up before history attach; claim auditing; dormancy threshold                                                                                                                                                                                                | Claim events on long-dormant profiles; support complaints "this isn't my history"                                                                  | Sec      | Until rev03 lands: every session touching identity                                         |
| R2  | Module boundaries erode under AI velocity → entangled monolith                                                                                                                                                                                                                                                                                                                                                           |   3 |   5 | **15** | Boundaries lint + meta-test (F-01 fix); PR review; monthly AI-code sample; annual audit                                                                                                                                                                                       | Lint-rule disable comments; cross-module type imports trending up; "temporary" direct joins                                                        | Arch     | Monthly                                                                                    |
| R3  | OTP/SMS pumping fraud after Phase 7                                                                                                                                                                                                                                                                                                                                                                                      |   4 |   3 | **12** | §6.6 controls in Phase 7 gate: rate limits, country allowlist, velocity alerts, kill switch, spend budget                                                                                                                                                                     | OTP request spikes from unusual ranges; delivery spend anomaly                                                                                     | Sec      | Weekly post-Phase-7 until stable, then quarterly                                           |
| R4  | Solo-founder bus factor / context loss                                                                                                                                                                                                                                                                                                                                                                                   |   3 |   4 | **12** | Everything in locked docs + ADRs + this package; repo remote + CI as provenance; runbooks                                                                                                                                                                                     | Undocumented decisions accumulating; ADR gaps vs merge history                                                                                     | Ops      | Quarterly                                                                                  |
| R5  | Mobile clients stranded by contract change (§1.3)                                                                                                                                                                                                                                                                                                                                                                        |   3 |   4 | **12** | Additive-only policy; frozen-snapshot contract tests; min-version gate                                                                                                                                                                                                        | Mobile error rate spikes correlated with API deploys                                                                                               | Arch     | Per release after Phase 9                                                                  |
| R6  | Single-Postgres degradation (vacuum/connections/noisy neighbor) (§1.4)                                                                                                                                                                                                                                                                                                                                                   |   3 |   4 | **12** | Trigger dashboard + pre-planned ladder (pgbouncer→worker split→replica)                                                                                                                                                                                                       | Connection % climbing; dead-tuple ratio; outbox lag creep                                                                                          | Ops      | Monthly via dashboards                                                                     |
| R7  | PII embedded in immutable events/logs → erasure impossible (§1.6)                                                                                                                                                                                                                                                                                                                                                        |   3 |   4 | **12** | PII-minimized payload ADR at Phase 6; log redaction serializer; crypto-shred design Phase 10. **Partial mitigation now in place:** ADR-0010 applies id-only payloads to the 3 new clinical prescription events, serving as adopted precedent for the remaining event families | Payload schemas containing name/phone fields; PII in log samples                                                                                   | Sec      | At every event-contract review                                                             |
| R8  | Clinical audit chain silently broken (trigger dropped/bypassed) — **scope widened by ADR-0010:** now includes `prescriptions_guard_update`/`prescriptions_no_delete` immutability triggers and the CREATE OR REPLACE of `clinical_audit_row()` (a Phase-5 artifact modified in an inter-phase slice — a mis-replace could silently degrade encounters/visit_notes auditing, not just fail to add prescriptions auditing) |   2 |   5 | **10** | Meta-test per release; restore-drill spot check; append-only verified at DB level; **for the widened scope specifically:** verify Phase-5 encounters/visit_notes audit behavior is unchanged post-ADR-0010, not just that prescriptions auditing works                        | Audit row count not tracking encounter activity; prescriptions audit rows missing/malformed after the ADR-0010 merge                               | Sec      | Per release                                                                                |
| R9  | False-assurance recurrence (inert guardrail shipped)                                                                                                                                                                                                                                                                                                                                                                     |   3 |   3 |      9 | Meta-test law (constitution §3.7); audits empirically test claims                                                                                                                                                                                                             | A guardrail with no test asserting it fires                                                                                                        | Arch     | Every audit                                                                                |
| R10 | Better Auth stagnation/breaking direction (§1.12)                                                                                                                                                                                                                                                                                                                                                                        |   2 |   4 |      8 | Own-table data; pinned versions; full auth suite = swap is testable                                                                                                                                                                                                           | Release cadence stalling; unpatched CVEs                                                                                                           | Arch     | Quarterly                                                                                  |
| R11 | Manual-gateway payment fraud via admin process (§6.8)                                                                                                                                                                                                                                                                                                                                                                    |   2 |   3 |      6 | Admin payment events audited; idempotency constraints; monthly reconciliation                                                                                                                                                                                                 | Reconciliation mismatches; visibility grants without matching revenue                                                                              | Prod     | Monthly (reconciliation)                                                                   |
| R12 | Search quality fails ckb/ar users (§1.7)                                                                                                                                                                                                                                                                                                                                                                                 |   3 |   2 |      6 | Normalizer + fixtures; zero-result-rate metric per locale                                                                                                                                                                                                                     | Zero-result rate divergence between locales                                                                                                        | Prod     | Monthly post-Phase-8                                                                       |
| R13 | Notification cost runaway (guest WhatsApp/SMS at volume)                                                                                                                                                                                                                                                                                                                                                                 |   2 |   3 |      6 | Channel-mix metric; push adoption push; spend budget alarm; §6 cost note accepted trade-off                                                                                                                                                                                   | Spend/booking ratio trending up                                                                                                                    | Ops      | Monthly post-launch                                                                        |
| R14 | Data-residency demand blocks country #2 (§1.10)                                                                                                                                                                                                                                                                                                                                                                          |   2 |   3 |      6 | Cell-model ADR pre-written; legal review first step of country onboarding                                                                                                                                                                                                     | Regulatory signals in target market                                                                                                                | Arch     | At expansion scoping                                                                       |
| R15 | Supabase platform/pricing shift                                                                                                                                                                                                                                                                                                                                                                                          |   2 |   3 |      6 | Infra-only usage = portable by design; Dockerized API; standard PG                                                                                                                                                                                                            | Pricing announcements; PITR/extension policy changes                                                                                               | Ops      | Quarterly                                                                                  |
| R16 | Vendor API churn (Meta WhatsApp templates/policy)                                                                                                                                                                                                                                                                                                                                                                        |   3 |   2 |      6 | Adapter isolation; template catalog governance; SMS fallback path                                                                                                                                                                                                             | Template rejections; deprecation notices                                                                                                           | Ops      | Quarterly post-Phase-7                                                                     |
| R17 | **New (ADR-0010):** patient-editable safety data (allergies, blood type via `patient_medical_profile`) uses option-A free upsert — no history, no audit trail — yet clinicians may come to rely on it when prescribing                                                                                                                                                                                                   |   2 |   4 |      8 | Rationale recorded in ADR-0010 (patient-owned safety data, no falsification incentive); re-review if doctors begin citing profile data in prescribing decisions                                                                                                               | Doctor-facing UI surfacing allergy/blood-type data during prescribing; incident where stale/edited profile data contributed to a clinical decision | Prod/Sec | At next full architecture audit (MM-QA-002); immediately if the early-warning sign appears |

---

# Document 14 — Future ADR List

Every ADR that should eventually exist. Numbering: actual numbers assigned against `docs/adr/` on disk at write time (numbering-divergence rule). P1 = required before a named milestone; P2 = required when its trigger trips; P3 = required before its product line is scoped.

| ADR (working title)                                                                                                                                                                                                                                     | Priority                                              | Suggested timing                                                                                                                                                                                                                               | Source              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Phase 6 closure (billing/payments decisions)                                                                                                                                                                                                            | **Done** — ADRs 0001–0009 on disk, Phases 0–6b merged | Phase 6 gate (existing practice)                                                                                                                                                                                                               | Plan §5             |
| **PII-minimized event payload policy**                                                                                                                                                                                                                  | P1                                                    | Inside or alongside the Phase 6 ADR — **partially realized:** ADR-0010 (inter-phase clinical extension) already applies id-only payloads to the 3 new clinical prescription events; remaining scope is billing/identity/booking event families | §1.6                |
| **Subscriptions subject polymorphism + explicit currency column**                                                                                                                                                                                       | P1                                                    | **Window closed — Phase 6/6b already merged.** Reclassify: verify what shipped against this recommendation; if absent, this becomes a future expand-migrate-contract item rather than a pre-kickoff check                                      | §8.7/§8.8           |
| **MM-DEC rev03: dormant-profile step-up on history claim**                                                                                                                                                                                              | P1                                                    | Before Phase 7 wires real OTP — **higher urgency:** ADR-0010 (inter-phase clinical extension) expanded the attached-history blast radius to include prescriptions, allergies, blood type, and reported medications (see §1.2)                  | §1.2                |
| **OTP/notification anti-abuse controls** (rate limits, allowlist, kill switch, budget)                                                                                                                                                                  | P1                                                    | Phase 7 gate criteria                                                                                                                                                                                                                          | §6.6                |
| ckb/ar search-text normalization (or record that Phase 3 already has it)                                                                                                                                                                                | P1                                                    | Verify now; before Phase 8                                                                                                                                                                                                                     | §1.7                |
| Mobile API compatibility policy (additive-only, min-version gate, frozen snapshots)                                                                                                                                                                     | P1                                                    | By end of Phase 8                                                                                                                                                                                                                              | §1.3                |
| Caching strategy + kernel CacheAdapter                                                                                                                                                                                                                  | P2                                                    | Phase 8 start                                                                                                                                                                                                                                  | §1.8                |
| Soft-delete / deactivation semantics                                                                                                                                                                                                                    | P2                                                    | Phase 8 (one page)                                                                                                                                                                                                                             | §9.4                |
| Organization/tenant entity (reserved design)                                                                                                                                                                                                            | P2                                                    | By end of Phase 8; implement when first org feature scoped                                                                                                                                                                                     | §1.11               |
| Worker process split (`ROLE` switch trigger)                                                                                                                                                                                                            | P2                                                    | Switch built Phase 6/7; ADR when trigger trips                                                                                                                                                                                                 | §1.5                |
| Backup/DR: RPO-RTO targets + restore-drill procedure                                                                                                                                                                                                    | P1                                                    | Phase 10                                                                                                                                                                                                                                       | §9.7                |
| Key management & crypto-shred design (rows, events, logs, backups)                                                                                                                                                                                      | P1                                                    | Phase 10                                                                                                                                                                                                                                       | §6.1                |
| Session/device management + step-up policy for clinical views                                                                                                                                                                                           | P2                                                    | Phase 9 design                                                                                                                                                                                                                                 | §6.2                |
| Outbox/audit/notification table partitioning scheme                                                                                                                                                                                                     | P2                                                    | When §9.2 thresholds approach; `clinical_access_log` scheme designed early (Phase 7-ish)                                                                                                                                                       | §9.2                |
| Reporting: read-replica → CDC/warehouse path                                                                                                                                                                                                            | P3                                                    | First reporting pressure post-launch                                                                                                                                                                                                           | §9.6                |
| Meilisearch adoption + reindex pipeline                                                                                                                                                                                                                 | P2                                                    | Search trigger (§1.4 table)                                                                                                                                                                                                                    | §1.7/§5.4           |
| FIB/ZainCash go-live security gate (signature, amount verification, replay)                                                                                                                                                                             | P2                                                    | Before either gateway is enabled                                                                                                                                                                                                               | §6.8                |
| Data residency / cell deployment model                                                                                                                                                                                                                  | P3                                                    | Before country #2 scoping                                                                                                                                                                                                                      | §1.10               |
| FHIR facade strategy + consent management sketch                                                                                                                                                                                                        | P3                                                    | Before first insurer/government conversation                                                                                                                                                                                                   | §8.5                |
| — _scope note:_ ADR-0010's structural separation of clinical prescriptions vs. patient-reported medications maps directly onto FHIR's `MedicationRequest` vs. `MedicationStatement` distinction — useful precedent for the facade design, not a new ADR | —                                                     | —                                                                                                                                                                                                                                              | §8.5                |
| Prescription notification templates (deferred to Phase 7 per MM-DEC §6, recorded in ADR-0010)                                                                                                                                                           | —                                                     | Phase 7 kickoff scope, not a standalone ADR                                                                                                                                                                                                    | §7 (plan), ADR-0010 |
| Telemedicine: VideoChannel adapter + recording policy                                                                                                                                                                                                   | P3                                                    | When telemedicine is scoped                                                                                                                                                                                                                    | §8.2                |
| AI-writes-toward-the-record threat model + human-in-the-loop rule                                                                                                                                                                                       | P3                                                    | Before any generative clinical feature is scoped                                                                                                                                                                                               | §8.3                |
| Directory/taxonomy module split                                                                                                                                                                                                                         | P2                                                    | §1.9 trigger                                                                                                                                                                                                                                   | §1.9                |
| tRPC/Zod major-version migration plan                                                                                                                                                                                                                   | P2                                                    | When either announces a major                                                                                                                                                                                                                  | §2.1                |
| Annual architecture review record (recurring)                                                                                                                                                                                                           | P1                                                    | Every 12 months from launch                                                                                                                                                                                                                    | Doc 12              |

---

# Document 15 — Final Executive Review

Written as the Chief Architect accountable for the next ten years.

## What worries me most

1. **Identity integrity, not infrastructure.** Nothing in this stack will fail catastrophically — Postgres, Fastify, and a monolith are boring on purpose. The thing that can genuinely hurt a person is R1: a recycled phone number handing someone else's medical history to a stranger, legitimately, through a flow working exactly as designed. It is the only finding in this package where the architecture as locked produces harm _without a bug_. It gets fixed on paper (MM-DEC rev03) before it can happen in production.
2. **Erosion, not explosion.** The second worry is R2 — the modular monolith quietly becoming a regular monolith through a thousand small agent-written conveniences. Phase 0 already demonstrated the exact mechanism: a guardrail that existed, looked right, and did nothing. The defense is not vigilance (vigilance doesn't scale to agent velocity); it is the meta-test law plus the audit cadence. If those two hold, the architecture holds.
3. **Verification debt at AI speed.** The system can now be built faster than it can be verified. Every process element in this package — gates, ADRs, audits, sampled reads, full reads on clinical/billing/identity — exists to keep verification within shouting distance of generation. The day "the gate passed" becomes a claim instead of an executed artifact, the 10-year story is over.

## What I would absolutely protect

- **Convention #1 (module data isolation)** and its enforcement mechanism. Every future option — extraction, cells, team scaling, honest audits — is downstream of it.
- **The clinical integrity chain**: append-only trigger audit, amendments-not-updates, time-boxed grants, deny-all RLS backstop. This is the platform's moral core and its regulatory shield; it is never "temporarily" relaxed for a feature.
- **Event contracts and the additive-forever rule**, extended to mobile-consumed procedures. Contracts are the only thing every client, module, and future integration shares.
- **Gate discipline.** Gates over calendars survived architectural review twice; they must survive commercial pressure too, especially in Phases 8–10 when the temptation to ship on a yellow gate peaks.

## What I would never compromise

- Strong consistency on booking and clinical writes. No "eventual" anywhere money or health is decided.
- Least privilege and the two-layer authz — no procedure ships with one layer "for now."
- PII discipline in logs, events, URLs. Once leaked into immutable stores, it is a permanent liability.
- The meta-test law. A guardrail without a proof it fires is worse than no guardrail — it is false assurance, the documented failure mode of the previous codebase.
- Phase-boundary stops in agent sessions. Chained phases are how discipline dies quietly.

## What I would continuously monitor

Outbox lag and DLQ depth (the health of the event spine) · booking p95 and the double-booking invariant (the strong core) · claim events on dormant profiles (R1, until rev03, then still) · OTP velocity and channel spend (R3, R13) · DB connection saturation and churn-table bloat (R6) · zero-result search rate per locale (R12) · lint-disable and cross-module import trends (R2's early warning) · the ratio of ADRs to significant merges (governance health) · Better Auth and Expo release health (R10, §2.1).

## The decisions most important to preserve

In order: module isolation (#1) · transactional outbox + consistency classification (#2/#4) · clinical-tier-only RLS with the empirically-grounded rejection of full-schema RLS (#6 — the most tempting to relitigate, and settled) · adapters-at-composition-root with no speculative seconds (#8) · config-over-code (#9) · Postgres-as-infrastructure-only portability · the trilingual/RTL day-one rule · gates-not-calendars.

## The mistakes that would be most expensive to make

1. **Shipping Phase 7's real OTP without MM-DEC rev03 and the anti-abuse controls** — the two ways this platform can be hurt (privacy breach, unbounded fraud cost) share the same phase.
2. **Letting one cross-module write "just this once"** — the precedent, not the line, is the cost; agents replicate precedent at scale.
3. **A breaking procedure change after mobile is fielded** without the §1.3 policy — stranded users, opaque failures, store-review latency compounding the fix.
4. **Trusting a green checkmark that overstates coverage** — the F-09c/F-01 class; the fix is structural honesty in CI, permanently.
5. **Warping internal clinical schemas toward an external standard (FHIR) instead of building the facade** — a decade of schema freedom traded for one integration's convenience.
6. **Relitigating settled decisions under pressure** (full-schema RLS, Redis, microservices, event sourcing) — each rejection is documented with evidence; the cost of reopening them is paid in the currency this project has least of: solo-founder attention.

## Closing position

The architecture as locked is sound for the stated decade — its risks are concentrated in identity semantics (fixable on paper, now), enforcement durability (fixable with the meta-test law and audit cadence, already adopted), and operational triggers (named, monitored, pre-decided). Nothing in this package asks for a redesign. It asks for four cheap amendments (rev03, PII-payload policy, Phase 6 schema polymorphism, mobile-contract policy), one standing law (every guardrail proves it fires), and a calendar of honest audits. That is the whole price of ten years.

---

_End of MM-ARC-002. Revision cadence: annually per Document 12, or on any locked-document amendment that touches its findings._
