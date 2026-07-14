# MM-QA-003 — Phase 9a Audit: Patient-Facing Expo Mobile App (Slices 1–6)

|                      |                                                                                                                                                                                                                                                                                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Date**             | 2026-07-14                                                                                                                                                                                                                                                                                                                                           |
| **Audited revision** | `main` @ `f3ddb20888442f3090db52c93eeb16324458df6b` (= `origin/main`; tree clean except the owner's own uncommitted CLAUDE.md draft, untouched by this audit)                                                                                                                                                                                        |
| **Working copy**     | WSL clone `~/mesomed` (authoritative per CLAUDE.md Development environment)                                                                                                                                                                                                                                                                          |
| **Scope**            | Phase 9a slices 1–6 as merged to `main` (PRs #24–#29 + close-out #30), audited against MM-PLAN-001 §5 Phase 9, ADR-0013, ADR-0018, ADR-0019, CLAUDE.md §Non-Negotiable Conventions, the Testing DoD, i18n catalog coverage, and the tRPC contract layer. Slice 0 process facts are included where they bear on slices 1–6. Phase 9b is out of scope. |
| **Method**           | Empirical per the MM-QA-002 precedent: every claim carries HOW it was verified (file:line inspected, command + result, or preserved log). No fixes were applied; the only file written is this report.                                                                                                                                               |

**Environment compliance note.** The audit session was invoked from the
Windows checkout (`C:\Users\Lenovo\Documents\MesoMed.rev2`). Per the binding
Development-environment rule, every repo probe ran against the WSL clone
`~/mesomed` (via `wsl.exe` commands and direct reads of the WSL filesystem);
the Windows checkout was neither built, tested, read as evidence, nor
written. No test suite was executed for this audit (audit-only instruction);
gate greenness is evidenced by GitHub CI conclusions and preserved local run
logs, cited per finding.

## Severity scale (MM-QA-001/002 precedent)

- **Critical** — an architecture invariant or phase gate is silently unmet.
- **High** — verified-broken core capability, or debt that corrupts subsequent phases.
- **Medium** — real gap; contained today, costs grow if carried into Phase 9b+.
- **Low** — hygiene/documentation debt; cheap now, noise later.

---

## 1. Evidence baseline

No local gate was run by this audit. The baseline is:

| #   | Evidence                                                                                              | Result                                                                                                                                                                                                                         |
| --- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B-1 | `gh run list --branch main` over the ten most recent `main` commits (`1ffc52a` → `f3ddb20`)           | **All `success`** — every Phase 9a merge (`c6e29c0`, `4154fb1`, `2f1b996`, `2374c7b`, `ea82936`, `49c3627`, `51d1baf`, `f3ddb20`) is CI-green. `main` gate is GREEN at audit time.                                             |
| B-2 | PR trail: `gh pr list --state merged`                                                                 | PRs #22, #24–#30 exist, one per slice + close-out, merged 2026-07-13/14. Convention #15 (branch → PR → merge) **conforms** for all of Phase 9a; `git log --first-parent` shows merge commits only.                             |
| B-3 | Frozen-pin history: `git log --oneline -- apps/api/test/contracts/frozen-router-surface.json`         | One commit only (`437cb76`, Phase 8 freeze). **Never regenerated during 9a** — conforms to ADR-0013's release-cut-only rule. `frozen-schema-surface.json` created once at `e54d24f` (Slice 6 initial pin, not a regeneration). |
| B-4 | Preserved forced-run logs `/tmp/turbo-test-run{,2,3}.log` (2026-07-14 03:14:16 / 03:19:37 / 03:24:37) | All three: `Tasks: 10 successful, 10 total` — the "3 consecutive forced serialized green runs" claimed in ADR-0019 deviation #6 and PR #29 **exist on disk and are green**.                                                    |
| B-5 | ADR-0019 count claim vs independent count of `apps/mobile/test/`                                      | Claim "mobile 5 test files / 15 tests" **accurate**: 3+3+2+3+4 = 15 `it` blocks across 5 files (independent read of every test file).                                                                                          |

---

## 2. Findings

Ordered by severity. Each finding: fact → Verified by → owner. No fixes were
applied in this session.

### F-01 · HIGH · MM-PLAN-001's Phase 9 gate item "offline-tolerant browsing (cached queries) verified" is unimplemented and untracked — absent from ADR-0019's shipped list AND its deviation list

**Fact.** MM-PLAN-001 §5 Phase 9's gate reads: "TestFlight + Play internal
track builds; push round-trip verified on physical devices; **offline-tolerant
browsing (cached queries) verified**." The mobile app has no offline
tolerance of any kind: the query client is a plain in-memory
`QueryClient` with only global `onError` wiring (`apps/mobile/lib/query-client.ts:13-18`)
— no persister, no `AsyncStorage`, no `onlineManager`/`networkMode`
configuration, no `staleTime`/`gcTime` tuning anywhere in `apps/mobile`.
ADR-0019 neither claims it shipped nor records it as a deviation, and its
"Remaining HUMAN gates" list (deviation #2: Maestro on device, push
round-trip, TestFlight/Play builds) omits it — so the human gate as currently
framed could be signed off with a MM-PLAN-001 gate item silently unmet. That
silent-unmet outcome is the Critical definition; it is scored High only
because the Phase 9a gate is still open (ADR-0019 explicitly halts at "ready
for human gate: device verification"), so the omission is correctable before
any certification.

**Verified by:** full read of `apps/mobile/lib/query-client.ts`;
`grep -rn "persist|AsyncStorage|offline|onlineManager|gcTime|staleTime|networkMode" apps/mobile/{lib,app}`
→ zero relevant hits; MM-PLAN-001 §5 Phase 9 gate line read; ADR-0019 read in
full (no occurrence of "offline" or "cached").

**Owner:** owner decision before the Phase 9a gate is certified — either a
follow-up slice implementing query persistence, or a dated ADR-0019 amendment
recording the item as deliberately deferred (with MM-PLAN-001 §6 note per the
resolution rule). Not self-certifiable.

### F-02 · MEDIUM · MM-PLAN-001 Phase 9 scope item "notification center" was silently dropped

**Fact.** MM-PLAN-001 §5 Phase 9 scope includes "push registration +
**notification center**". Phase 9a shipped push token register/unregister
(`apps/mobile/app/(tabs)/account.tsx:32-33` on
`communication.registerDeviceToken`/`unregisterDeviceToken`) but no
notification-center surface exists (`grep -rni notification apps/mobile/app apps/mobile/lib`
→ only `lib/push.ts` expo-notifications calls). There is a real technical
reason — the only notification-listing procedure is admin-scoped, so a
patient notification center would require new API surface — but ADR-0019
records neither the drop nor the reason. Same drift class as F-01: a plan
scope item absent from both the shipped list and the deviations.

**Verified by:** MM-PLAN-001 §5 Phase 9 scope line; grep cited above;
ADR-0019 read in full (no mention); the 23-procedure consumed list
(`apps/api/test/router-schema-surface.test.ts:42-66`) contains no
notification-read procedure.

**Owner:** dated ADR-0019 amendment recording the deferral + rationale;
implementation (new patient-scoped query + screen) belongs to a future slice,
not to the amendment.

### F-03 · MEDIUM · The unattributed Slice 6 test failure cannot be named — and cannot even be confirmed to have been a test failure; here is precisely why

**Fact.** The audit brief requires naming the failing test from ADR-0019
deviation #6 or stating precisely why it cannot be named. **It cannot be
named, from any evidence that still exists.** The complete evidence chain:

1. The only preserved output of the failing run is the session transcript's
   capture of a `tail`-piped command. It contains exactly:
   `@mesomed/api#test: ERROR command (/home/lenovo/mesomed/apps/api) /mnt/c/Users/Lenovo/AppData/Roaming/npm/pnpm run test exited (1)` /
   `Tasks: 9 successful, 10 total` / `Failed: @mesomed/api#test`. No vitest
   `FAIL` line, no test name, no file name survived the pipe — everything
   above turbo's summary was truncated by `tail`.
2. Turbo's per-package log (`apps/api/.turbo/turbo-test.log`) is a
   single-slot file; its current content is the **third forced green run**
   (mtime 2026-07-14 03:24:37, ends `60 passed / 548 passed`). The failing
   run's copy was overwritten before it was read — as ADR-0019 states.
3. No other trace exists: no `.turbo/runs/` summaries (directory absent), no
   turbo daemon cache logs, no shell-history entry, and every other preserved
   log in `/tmp` from the Slice 5–6 window (`test-run-{1,2,3}.log`,
   `turbo-test-run{,2,3}.log`) is a fully green run.
4. Consequence stronger than ADR-0019 states: because only turbo's
   _task-level_ `exited (1)` survived, it cannot even be confirmed that a
   vitest test failed at all — a task-level exit 1 is equally consistent
   with a process/spawn-layer failure (see F-04 for a concrete candidate
   vector). "One test failed" is an inference, not an evidenced fact.

The handling itself conformed to the flaky policy as amended (MM-ARC-002
§3.7): not re-run-to-green (three _forced_ serialized runs + a standalone api
run as a reproduction attempt), not quarantined, candidly documented in the
commit, PR #29, and ADR-0019 deviation #6, with tee'ing adopted so any
recurrence is named. The residual gap is that the observation is
unfalsifiable until a recurrence.

**Verified by:** session transcript grep (quoted line 1 above); `stat` +
tail of `apps/api/.turbo/turbo-test.log`; `find` for `.turbo/runs` and
`~/.cache/turborepo` → absent; `grep "turbo run test" ~/.bash_history` →
no entries; per-log failure scan of all nine preserved `/tmp` gate logs.

**Owner:** no action possible on the attribution itself. The standing
obligation (tee every gate run) is already in effect — B-4's logs are the
proof. If it recurs, root-cause per policy; F-04 is the first hypothesis to
test.

### F-04 · MEDIUM · Every local gate run spawns its package tasks through the WINDOWS pnpm shim via WSL interop — undocumented, and a plausible vector for exactly the F-03 failure shape

**Fact.** In the WSL clone, `which pnpm` resolves to
`/mnt/c/Users/Lenovo/AppData/Roaming/npm/pnpm` — the Windows npm-global shim,
reached through the WSL interop `PATH`. The documented toolchain
(`corepack pnpm` from the nvm node bin) covers only the _top-level_
invocation: turbo, once running, re-resolves bare `pnpm` from `PATH` for each
package's task, and the nvm bin (`~/.nvm/versions/node/v24.16.0/bin`)
contains **no pnpm/corepack shim** (`claude corepack firecrawl node npm npx`
only). So every `@mesomed/*:test` task in every local gate run crosses the
Windows-interop boundary. The failing Slice 6 run proves this is not
hypothetical — its one surviving line (F-03 item 1) shows turbo spawning
exactly that `/mnt/c/.../pnpm run test`. Version skew is ruled out (the
Windows shim is also pnpm 11.10.0, matching the `packageManager` pin), so
this is an integrity/reliability posture issue, not a correctness one: an
interop-spawned process adds a failure layer (9p filesystem hop, Windows
process launch) that can produce task-level exit-1 noise with no vitest
output — the F-03 shape. CI is unaffected (Linux runners, `pnpm/action-setup`).

**Verified by:** `which pnpm` and `echo $PATH` in a WSL login shell;
`ls ~/.nvm/versions/node/v24.16.0/bin/`; `pnpm --version` on the Windows side
→ `11.10.0`; root `package.json` `"packageManager": "pnpm@11.10.0"`; the
transcript-preserved spawn line quoted in F-03.

**Owner:** pre-Phase-9b hygiene — either `corepack enable` in the WSL node
bin (puts a Linux pnpm shim ahead of `/mnt/c` on `PATH`) or an explicit
`PATH` note in the CLAUDE.md Development-environment section; then observe
whether F-03-class noise recurs. One-line fix, but it changes gate-run
environment, so it lands as its own commit, not silently.

### F-05 · MEDIUM · Testing DoD: two pure-logic mobile modules with real branching have zero tests

**Fact.** Convention #12's first leg ("unit tests for pure domain logic")
translated to the thin client covers pure lib modules. Coverage is 5 of 14
modules; the two uncovered ones with genuine branching logic are:
`apps/mobile/lib/localized.ts` (`pickText`/`pickOptionalText` — the ckb→ar→en
localized-text fallback chain) and `apps/mobile/lib/media.ts` (`mediaUrl()` —
absolute-vs-relative URL branching). Both are ports of web-side mirrors, and
neither has a test on either side of the port. The other seven uncovered lib
modules are trivial wiring/singletons (`api-headers.ts`, `trpc.ts`,
`auth-client.ts`, `app-version.ts`, `push.ts` wrapper, `query-client.ts`,
`locale.tsx` provider) — noted, not scored. The five covered modules
(`rtl.ts`, `push-platform.ts`, `upgrade-required.ts`, `country-coming-soon.ts`,
`create-auth-client.ts`) include the one real client-driven integration test
(`test/auth-persistence.test.ts` — live server + Postgres, runs in CI).

**Verified by:** full inventory of `apps/mobile/test/` (5 files, 15 tests,
every test name read) against a listing of `apps/mobile/lib/` (14 modules);
`localized.ts` and `media.ts` read (branching confirmed); no test imports
either module (grep).

**Owner:** small additive test PR (pure functions, no harness needed); can
ride any future mobile-touching slice without bundling concerns.

### F-06 · MEDIUM · MM-PLAN-001 §6 amendment log and ADR index are eight ADRs stale, and the biometrics resolution has no dated amendment note in the affected document

**Fact.** CLAUDE.md's locked-document rule: "Resolutions land as an ADR plus
a **dated amendment note in the affected document**." The biometrics
contradiction (phase instruction + MM-PLAN-001 §5 Phase 9 "biometric unlock
(expo-local-authentication after first login — MM-DEC §4)" vs MM-DEC rev02
§4 "Biometric authentication is **not** part of this strategy") was resolved
by owner decision 2026-07-14 and recorded in ADR-0019 — but MM-PLAN-001
carries no amendment note: §5 Phase 9 still instructs biometric unlock and a
"login+biometric" Maestro flow, and §6's amendment log ends at the
2026-07-13 convention-#15 entry. More broadly, §6's "ADR filename index"
stops at ADR-0011 — ADRs 0012–0019 (Phase 8 caching seam, mobile compat
policy, soft-delete, org-reserved, Phase 8 web app, otel port, Slice 0
toolchain, Phase 9a close-out) are all absent from the index that calls
itself authoritative.

**Verified by:** MM-PLAN-001 §5 Phase 9 text and §6 read at `f3ddb20` (last
entry "2026-07-13 — §3 convention #15 added"; index's last entry `0011`);
ADR-0019 "Decisions of record" (biometrics exclusion recorded there only);
`ls docs/adr/` (0001–0019 on disk).

**Owner:** docs-only PR: dated §6 entries for ADR-0012–0019 (the biometrics
entry doubling as the required amendment note against §5 Phase 9), following
the ADR-0009 supersession pattern.

### F-07 · LOW · A booking-domain transition rule is hard-coded in the mobile client

**Fact.** `apps/mobile/app/dashboard/appointments.tsx:9` —
`const CANCELLABLE = new Set(["booked", "confirmed"])` — gates the cancel
button (`:100`). Which appointment statuses are cancellable is a booking
state-machine rule; the client duplicates it rather than deriving it from
server data. The server still authorizes (the optimistic-cancel `onError`
at `:43-45` rolls back a rejected cancel), so this is UI-gating only — but in
a shipped binary that cannot be hot-fixed (ADR-0013's own premise), a
server-side change to the cancellable set leaves stale buttons in the field.
Two adjacent minor notes, same class: `app/book/[slug].tsx:127` pages the
availability window with local `±7 × 86_400_000 ms` date arithmetic
(navigation math; server computes actual slots), and
`app/dashboard/health.tsx:316` selects the "current" prescription revision by
last-array-position, baking in a server-ordering assumption.

**Verified by:** cited files/lines read in full; server authz path confirmed
by the rollback branch in the same file.

**Owner:** Phase 9b or a mobile hygiene slice — e.g. a `cancellable` flag in
the `booking.myAppointments` output (additive, pin-safe per ADR-0013).

### F-08 · LOW · Screen-level behaviors have no executed test at any layer; the authored Maestro flows cover only happy paths and none of the risky branches

**Fact.** There are zero component/screen tests (vitest `include` is
`test/**/*.test.ts`; no test imports anything from `app/`). The behaviors
carrying real logic are each untested: SLOT_UNAVAILABLE recovery
(`app/book/[slug].tsx:75-77`), optimistic cancel with rollback
(`app/dashboard/appointments.tsx:25-47`), the sign-up OTP claim UI
(`app/auth/sign-up.tsx` — the _library_ claim path is integration-tested,
the screen is not), the triage red-flag banner (`app/(tabs)/search.tsx`),
and tab navigation. The three Maestro flows cover sign-in+relaunch-restore,
a read-only dashboard view, and the happy guest-booking path — none of the
five behaviors above — and do not run in CI (no Maestro step in `ci.yml`;
execution is the pending device human gate). This is a known consequence of
the accepted RN-testing posture, recorded here so the coverage boundary is
explicit rather than implied.

**Verified by:** `apps/mobile/vitest.config.ts:24`; all three
`.maestro/*.flow.yaml` read step-by-step; `.github/workflows/ci.yml` read
(no Maestro/EAS step); cited screen files read.

**Owner:** device human gate (executes the three flows as authored);
extending Maestro to the SLOT_UNAVAILABLE and cancel paths is a candidate
for the release-cut checklist, owner's call.

### F-09 · LOW · Two hardcoded user-visible placeholder strings bypass the catalogs (convention #10)

**Fact.** Out of 151 consumed i18n keys (all present and non-empty in
en/ar/ckb — see conformance table), exactly four literal user-visible prop
strings exist, all placeholders: `placeholder="+964…"` at
`app/auth/sign-in.tsx:53`, `app/auth/sign-up.tsx:160`, `app/book/[slug].tsx:347`
(country-code example; borderline — digits + ellipsis, no prose), and
`placeholder="YYYY-MM-DD"` at `app/book/[slug].tsx:358` (the DOB input's
format hint — the clear violation: it is displayed text, is not translated,
and its Latin format tokens mean nothing in ar/ckb).

**Verified by:** full sweep of every `.tsx` in `apps/mobile` for literal
text-bearing props and JSX text nodes (agent sweep, files enumerated; all
other literals are punctuation/separators or RN config enums).

**Owner:** two-key catalog addition (`web.book.dobPlaceholder`-style) in any
mobile-touching PR.

### F-10 · LOW · No guardrail ties mobile-consumed i18n keys to the catalogs — a consumed-but-missing key would pass CI (inert-guardrail class, R9)

**Fact.** The catalog parity test
(`packages/i18n/src/catalogs.test.ts:12-16,38-49`) enforces three-way key-set
equality and non-empty values — including the `mobile.*` namespace — but
nothing asserts that keys the mobile app _consumes_ exist at all: a
`t("typo")` against a key absent from all three catalogs passes CI (equal
sets, use-intl fails only at runtime). The 151-key verification in this
audit was a one-off Node cross-check, not a standing test. Same R9
(inert-guardrail) class MM-QA-002 flagged in F-04/F-05/F-06 of that report.

**Verified by:** `catalogs.test.ts` read in full; grep for any
consumed-key/usage test across `apps/mobile/test` and `packages/i18n` →
none; the one-off cross-check output (`checked 151 unique keys; problems=0`).

**Owner:** pre-Phase-9b or 9b slice 0 — a static extraction test (grep
`t("...")` + namespace resolution) in `apps/mobile/test/`.

### F-11 · LOW · The authored Maestro flow set silently diverges from MM-PLAN-001's named list

**Fact.** MM-PLAN-001 §5 Phase 9 names the flows: "booking,
**login+biometric**, **push receipt**". Authored:
`guest-booking.flow.yaml`, `auth-sign-in.flow.yaml` (sign-in + relaunch
restore), `dashboard.flow.yaml`. The biometric half of flow 2 is explained by
the recorded biometrics exclusion; the **push-receipt flow is absent with no
note anywhere** (ADR-0019 deviation #1 lists the three authored flows but
never maps them against the plan's list), and `dashboard` is a substitution
the plan never named. Push round-trip is separately listed as a device-gate
item, so the _capability_ is tracked — the flow-list divergence is a
documentation gap, not a coverage hole beyond F-08.

**Verified by:** MM-PLAN-001 §5 Phase 9 Maestro line; `ls apps/mobile/.maestro/`;
all three flows read; ADR-0019 deviation #1 read.

**Owner:** fold into the F-06 docs PR (one sentence in the ADR-0019
amendment) or author the push-receipt flow at the device gate.

---

## 3. Per-area conformance table

| Area                              | Verdict                                   | How verified                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Findings                                                                                         |
| --------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| MM-PLAN-001 §5 Phase 9 scope/gate | Drift on 3 items                          | Scope/gate lines diffed item-by-item against shipped code + ADR-0019                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | **F-01, F-02, F-11**                                                                             |
| ADR-0013 (compat policy)          | **Conforms** (full check)                 | Kernel gate `app-version.ts:35-50` (no-header/no-row/malformed asymmetries all present as specified); mobile sends header (`app/_layout.tsx:53`); blocking screen gates whole tree (`_layout.tsx:22-42`); both pins exist, `UPDATE_FROZEN_SURFACE=1` gates quoted at `router-surface.test.ts:52`, `router-schema-surface.test.ts:206`; pins never regenerated out-of-cut (B-3). **Key check: the 23-entry `MOBILE_CONSUMED` pin vs an exhaustive sweep of every tRPC call in `apps/mobile` is an exact bidirectional match — zero unpinned-consumed, zero pinned-unconsumed.** | — (one filename nit: the version header lives in `lib/app-version.ts`, not `lib/api-headers.ts`) |
| ADR-0018 (toolchain)              | Conforms, one blind spot                  | `pnpm-workspace.yaml:9` `nodeLinker: hoisted` + explanatory comments; `.npmrc` clean of `node-linker`; CI exercises `expo export` for 3 platforms via turbo `build` (`ci.yml:61-62` → `apps/mobile/package.json:11`, `turbo.json:5-8` outputs cover `dist/**`); RTL evidence `docs/rtl-review/phase8/` exists (34 PNGs)                                                                                                                                                                                                                                                        | F-04 (the shim posture ADR-0018 didn't examine)                                                  |
| ADR-0019 (close-out claims)       | **Conforms** (every checkable claim true) | Biometrics: zero code/dependency hits repo-wide (all grep matches are docs, the `@expo/fingerprint` build tool, or `interface Identity` false positives); secure-store sessions (`lib/auth-client.ts:1,9`); 3 Maestro flows as named; `eas.json`/`app.json` files-only, no secrets, only `EXPO_PUBLIC_API_URL` baked; runbook exists; push degrades silently (`lib/push.ts:17-29`, never throws); test counts accurate (B-5)                                                                                                                                                   | —                                                                                                |
| Conventions: thin client / #1     | Conforms                                  | Zero `@mesomed/db`/drizzle/pg/SQL in app source; db imports confined to `test/auth-persistence.test.ts:4-5` (integration seeding, devDependency only)                                                                                                                                                                                                                                                                                                                                                                                                                          | F-07 (one duplicated domain rule, UI-gating only)                                                |
| Conventions: tRPC contract layer  | **Conforms**                              | Zero `fetch`/axios/XHR/WebSocket in app source; all data via `trpc.*` hooks; Better Auth client is the sanctioned auth transport (`lib/create-auth-client.ts`, cookie bridge `_layout.tsx:58`); raw `fetch` only in the integration test's seeding                                                                                                                                                                                                                                                                                                                             | —                                                                                                |
| Conventions: #11 typed errors     | **Conforms**                              | Every error-inspection site enumerated: all keyed on `error.data?.appCode === ErrorCode.X` or boolean `.error` flags; **zero** message-string parsing anywhere                                                                                                                                                                                                                                                                                                                                                                                                                 | —                                                                                                |
| Conventions: #13 no any/ts-ignore | **Conforms**                              | Zero `any`/`@ts-ignore`/`@ts-expect-error`/inline eslint-disable across all 56 swept files; casts are typed narrows; strict tsconfig incl. `noUncheckedIndexedAccess`                                                                                                                                                                                                                                                                                                                                                                                                          | —                                                                                                |
| Conventions: #10 i18n + RTL       | Conforms with 2 gaps                      | 151/151 consumed keys (incl. 12 dynamic-key expansions from contracts enums) present + non-empty in en/ar/ckb; all dates via `formatLocalizedDate` (zero `toLocaleDateString`/dayjs); zero physical-direction properties (logical `me-`/`ps-`/`insetInlineStart` in use; `writingDirection:"ltr"` pins on phone/date/OTP fields; `I18nManager.isRTL` only for chevron glyph + the RTL bootstrap)                                                                                                                                                                               | F-09, F-10                                                                                       |
| Testing DoD (#12)                 | Partial                                   | 5 files/15 tests inventoried test-by-test; 1 genuine client-driven integration test (live server + PG, runs in CI); schema-contract pin strong (real pin + 3 meta-tests proving both firing directions and additive tolerance); 5/14 lib modules covered                                                                                                                                                                                                                                                                                                                       | F-05, F-08                                                                                       |
| Process (#15, gate discipline)    | **Conforms**                              | B-1, B-2: every slice branch → PR → CI-green → merge; `main` green at audit time; flaky policy followed for the Slice 6 event (B-4)                                                                                                                                                                                                                                                                                                                                                                                                                                            | F-03 (attribution unrecoverable), F-04                                                           |

---

## 4. The unattributed Slice 6 failure — disposition

Required audit item, answered in **F-03**: the failing test **cannot be
named**; the evidence chain (tail-truncated transcript → overwritten
single-slot turbo log → no secondary traces) is exhausted, and the surviving
line shows only a task-level `exited (1)`, which cannot distinguish a vitest
failure from a spawn-layer failure. It was **not** cleared by re-run: the
three forced runs on disk (B-4) were the policy-mandated reproduction
attempt, and the tee'ing that would have named it is now standing practice.
F-04 supplies the first concrete hypothesis (Windows-interop pnpm spawn) to
test against any recurrence.

## 5. Prioritized remediation list

1. **F-01** — owner decision on offline-tolerant browsing (implement or
   formally defer with dated amendments) **before** the Phase 9a gate is
   certified.
2. **F-06 (+F-02, F-11)** — one docs PR: MM-PLAN-001 §6 entries for
   ADR-0012–0019, dated biometrics amendment note, notification-center and
   Maestro-list deferral notes in an ADR-0019 amendment.
3. **F-04** — `corepack enable` (or equivalent PATH fix) in the WSL
   toolchain so gate tasks stop crossing the Windows interop boundary; own
   commit.
4. **F-05** — unit tests for `localized.ts` and `media.ts`.
5. **F-10** — consumed-key extraction test so i18n coverage is a standing
   guardrail, not a one-off audit check.
6. **F-09** — catalog keys for the `YYYY-MM-DD` (and optionally `+964…`)
   placeholders.
7. **F-07** — additive `cancellable` flag server-side when convenient
   (pin-safe); F-08 rides the device gate.

## 6. Phase 9a gate / Phase 9b statement

`main` is CI-green and Phase 9a's process discipline held throughout (every
slice PR'd, gated, merged; pins intact; flaky policy honored). **No Critical
finding.** The phase's remaining human gate ("device verification") is,
however, **incompletely framed**: as listed in ADR-0019 it omits the
MM-PLAN-001 gate item offline-tolerant browsing (F-01) — certifying the gate
from that list as-is would convert F-01 into a Critical
(gate-silently-unmet) after the fact. Recommendation: resolve F-01's
disposition and land the F-06 documentation reconciliation before or
alongside the device-verification sign-off. Phase 9b remains not started, per
instruction; nothing in this audit blocks its eventual kickoff except the
F-01 disposition belonging to Phase 9a.

---

_Audit performed read-only from the WSL clone at `f3ddb20`. No code, test,
config, or existing document was modified; MM-QA-002 was not touched. The
only file created is this report. Verification that could not be performed:
no local test suite was executed (audit-only instruction — greenness cited
from CI and preserved logs), and the 200k-row/perf and RTL-visual areas were
out of scope for this phase audit._
