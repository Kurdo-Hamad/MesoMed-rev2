# ADR-0034 — MM-QA-004 Slice 3b: privacy policy + terms (F-02 content half)

## Status

Accepted under the 2026-07-18 owner override (ADR-0031 amendment),
which suspends the per-PR approval pause. **The privacy/terms text
merges as a DRAFT: it is pending owner + legal-counsel review before
store submission, and nothing about merging makes it legally
reviewed** (plan rule 7 — legal content is never self-certified; the
ar/ckb translations additionally carry the standing native-speaker
human gate). Executes `docs/qa/MM-QA-004-Remediation-Plan.md` Part 1
Slice 3, content half (3b); the code half (account deletion) landed as
Slice 3a (ADR-0033).

## Context

F-02 (High): zero privacy-policy or terms content existed in web pages,
mobile screens, i18n catalogs, or docs. Apple and Google both require a
privacy policy URL for store submission, and the platform collects
patient PII and clinical data — lawful operation needs published terms.
HG-1 (store submission) is blocked until these exist.

## Decision

1. **Web routes** `/{locale}/privacy` and `/{locale}/terms`
   (`localePrefix: "always"`), static server components rendering
   sectioned content from the catalogs. Linked from the site footer on
   every page.
2. **Content lives in the i18n catalogs** (`web.legal.*`, en/ar/ckb,
   exact key parity — enforced by the existing catalogs parity test),
   per convention #10: no hardcoded user-facing strings, RTL rendering
   free via the existing locale layout.
3. **Mobile**: the account tab links to the web privacy/terms pages in
   the user's current locale via `EXPO_PUBLIC_WEB_URL` (default
   `https://mesomed.krd`, set per-profile in `eas.json` — same pattern
   as `EXPO_PUBLIC_API_URL`). Links are visible signed-in AND signed-out
   so store reviewers can always reach them. A native legal screen is
   deliberately not built: the store requirement is a reachable policy
   URL, and one canonical copy avoids drift.
4. **Release-cut runbook** (§5 store submission): now lists the
   store-side prerequisites that feed HG-1 — privacy policy URL, Apple
   App Privacy labels, Google Play Data safety form, and the in-app
   account-deletion disclosure both stores ask for.
5. **Drafting stance**: the content documents what the platform actually
   does (data collected, channels used, retention windows and the
   never-delete clinical rule from the retention runbook, in-app
   deletion, support-grant access, processors, Iraq/KRI governing law).
   It is a launch draft written by engineering. Under the 2026-07-18
   owner override it merges as a DRAFT — owner + counsel review the
   text (and the contact address, currently `mesotrip.official@gmail.com`,
   unconfirmed) before store submission; ar/ckb translations
   additionally carry the standing native-speaker human gate.

## Provider-account deletion path — disposition in writing (owner-directed)

Owner directive (2026-07-17, PR #75 approval): the provider-account
deletion path must be dispositioned in writing, because store rules
cover any in-app-creatable account and providers create accounts
in-app.

**Current state (verified in code):** `identity.deleteAccount` (Slice
3a) is role-agnostic — a provider can call it. For a provider the flow
deletes the Better Auth user and cascades `provider_profiles`. But the
directory module mirrors approval state only from
`identity.provider_status_changed.v1` events
(`directory.sync-provider-approval`), and a cascade emits no event —
so an **approved, publicly-listed doctor who self-deletes would leave a
dangling public listing** (`providers.approved` stays true,
`doctor_profiles.publiclyVisible` stays true, the listing remains
visible and bookable with no account behind it). For never-approved
providers and secretaries the flow is already clean.

**Disposition:** provider accounts keep the self-service path (store
rules are satisfied by the same in-app flow), and the missing directory
retirement is a **named code change in the F-02 close-out slice** (the
owner's stated alternative venue), spec'd as:

- `deleteAccount` reads the caller's `provider_profiles` row (identity-
  owned) before deletion and, when one exists, includes
  `providerProfileId` in the emitted event (id-only — no PII; additive
  v2 of `account_deleted` or an additive nullable field per convention
  #3).
- A directory subscriber retires the listing (set `approved = false`,
  recompute visibility) keyed by that id — the exact mechanism
  `on-provider-status-changed.ts` already implements.

**Interim risk — proposed for owner acceptance at this PR's review:**
until that close-out lands, a provider self-deletion leaves the
dangling-listing gap described above. At current volume (pre-launch, no
production providers) the window is proposed as acceptable; it must be
closed before HG-5/launch. If the owner prefers the alternative — deny
provider self-deletion with a typed error and an admin-mediated manual
runbook path — that is a smaller change but weakens the
store-compliance story; flagged as the option NOT chosen. This is a
**delegated ruling under owner override — ratification pending**; the
close-out code fix lands as the immediately following slice, and a
different owner ruling reopens this section as a dated amendment.

_Amendment (2026-07-18): the close-out code fix landed as ADR-0038
(`identity.account_deleted.v2` carrying `providerProfileId` + the
`directory.retire-deleted-provider` subscriber)._

## Tests (convention #12)

Content slice: no domain logic. The existing i18n parity test enforces
en/ar/ckb key parity and non-empty values for all new `web.legal.*`
keys; lint/typecheck/build cover the new routes and links. No new test
infrastructure invented for static pages.

## Gate

Pre-slice (uncached, WSL, repo root): format GREEN · lint/typecheck
20/20 · test 11/11 tasks, 965 tests / 131 files, zero failed ·
build 3/3 — the ADR-0036 post-slice gate on the tree that squash-merged
verbatim to main `a5011d3` (CI verified green, run 29619741425). The
slice originally started from main `36039eb` (963/129, run 29607101730) and was rebased across the ADR-0035/0036 interrupts.
Post-slice: format GREEN · lint/typecheck 20/20 · test 11/11 tasks,
965 tests / 131 files, zero failed · build 3/3 (content slice — no new
tests; the i18n parity test covers the new `web.legal.*` keys).
