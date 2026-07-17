# MASTER PROMPT — MM-QA-004 Remediation (all 28 findings)

Paste this into Claude Code in `~/mesomed` (WSL). Work top to bottom. One slice at a time.

---

## Context

You are remediating every finding in `docs/qa/MM-QA-004-Prelaunch-Audit.md` (audited revision `f3be3e8`). The owner (Hakeem) has ruled: **all 5 Highs are launch blockers — fix now. All Mediums — fix now. All Lows — fix per the bundles below.** No finding is accepted as debt except F-21 (recorded fact, no action).

Read the audit report in full before starting. Every finding below references its evidence there.

## Non-negotiable process rules (violating any of these = stop and report)

1. One slice = one branch = one PR = squash-merge. **No bundling.** Doc-only changes get their own PR.
2. Run `pnpm exec prettier --write` on touched files before every push (doc-only PRs included).
3. CI evidence: `gh run view <id>` on the **merge commit on main** is the only authoritative green. `gh run list` / `gh pr checks` can be stale.
4. A red main blocks all new work. Never start the next slice until the previous merge commit is verified green.
5. Never edit a shipped migration file (F-21 precedent). Fixes ship as **new** migrations.
6. Locked documents (MM-DEC rev02, MM-PLAN-001 locked sections): you may propose changes, never self-edit. Changes go through the ADR + dated-amendment pattern with explicit owner approval in the PR.
7. Human gates (HG-1..HG-5, deploy) are owner-executed. You never self-certify any of them. Where a slice below touches a human gate, you prepare the material and leave the gate OPEN.
8. Before each slice, run the full local gate (`format:check`, `turbo lint typecheck --force`, `turbo test --concurrency=1 --force`, `turbo build --force`). After each slice, run it again. Report counts.
9. Pause after each PR is opened. The owner reviews and approves the merge. Do not merge without an explicit go from the owner in the conversation.

---

## PR 0 (doc-only) — Disposition amendment · MUST BE FIRST

Dated amendment to ADR-0031 recording the owner's 2026-07-17 ruling on MM-QA-004:

- F-01..F-05 (High): launch blockers, fix pre-HG-5. F-01's ruling satisfies MM-DEC rev02 §5 by **implementing** it, so no locked-doc amendment is needed — state this explicitly.
- F-06..F-14 (Medium): all fix-now, as the named slices listed in this amendment (mirror the slice list below).
- F-15..F-28 (Low): fixed via the bundles listed below; F-21 recorded, no action.
- Note the §4 orchestrator observation: `SENTRY_DSN` provisioning added to HG-2 scope (see Slice 4).

Also in this PR: correct the erasure runbook's false row (F-04 documentation half) — change `docs/runbooks/data-retention-erasure.md:22` from "id-only by design — verified" to the true state ("identity v1 events carry phone/email; remediation in flight, see F-04 slice"), and add the matching one-paragraph ADR-0028 correction. A launch-facing document must not keep a false "verified" claim while code work proceeds.

---

## Part 1 — The 5 Highs (in this order)

### Slice 1 · F-05 — Web booking error classification (one file)

`apps/web/app/[locale]/book/[slug]/page.tsx`: replace `classifyBookingError` regex-over-message with a switch on `error.data?.appCode === ErrorCode.SLOT_UNAVAILABLE`, exactly mirroring `apps/mobile/app/book/[slug].tsx:75`. Add a test that fails if classification ever reads `error.message`. Done when: repo-wide `rg '\.message\.(includes|startsWith|match|indexOf)'` over both clients returns zero.

### Slice 2 · F-04 — domain_events PII (code half; docs already fixed in PR 0)

Owner ruling: **v2 id-only identity events** per convention #3.

- Introduce `identity.*.v2` event schemas with PII fields removed (ids only); update emit sites (`complete-provider-signup.ts`, `ensure-patient-registration.ts`); keep v1 schemas registered read-only for old rows.
- New migration: redact `phone`/`email`/`normalizedPhone` from payloads of existing identity v1 rows in `domain_events` (UPDATE payload, preserve ids/times). Idempotent.
- Update the erasure runbook row to its final true state ("id-only as of migration NNNN — verified") and close MM-QA-002 F-07 by name in the ADR for this slice.
- Tests: contracts event-set test updated; a test asserting no identity event schema contains phone/email fields.

### Slice 3 · F-02 — Account deletion + privacy policy + terms

Split into two PRs (code vs content):

**3a (code): account-deletion flow.** Identity-module procedure (authenticated, self-only) implementing the erasure runbook's matrix: anonymize `patient_profiles`, prune `notification_log`, revoke sessions, honor the F-04 posture for `domain_events`. Surface it in mobile (both apps' account screens) and web. Denial tests + a test that the flow executes every runbook matrix row. This is what Apple/Google require in-app.

**3b (content): privacy policy + terms pages.** Web routes (all three locales) + linked from mobile account screens; i18n keys added to en/ar/ckb catalogs with exact key parity. **Draft the content, but flag in the PR that the owner must review it before merge — legal content is owner-approved, never self-certified.** Update the release-cut runbook: store submission requires the policy URL + data-safety forms (feeds HG-1).

### Slice 4 · F-03 — Outage detection + incident runbooks

- Fix `docs/observability/alerts/alert-rules.yaml`: an API-down condition must page. Add an alert on absence of the API's own heartbeat/scrape (so silence fires), and document why each `noDataState` is what it is.
- Add external uptime probe config as code/docs (Grafana Cloud synthetic monitoring on `/health` + `/ready`, plus the MM-ARC-002 §10.8 synthetic guest-booking probe) — provisioning itself is HG-2 owner work; extend the HG-2 checklist item in ADR-0031 (dated amendment inside this slice's ADR) to include probes + `SENTRY_DSN` provisioning.
- Write the six MM-ARC-002 §10.9 incident runbooks: API down, DB degraded, outbox stalled, provider outage, OTP abuse, data breach. Each: detection signal → first 15 minutes → escalation → verification of recovery.

### Slice 5 · F-01 — Password recovery (largest slice; keep it last of the Highs)

Implement MM-DEC rev02 §5 as written:

- Patient: recovery via WhatsApp OTP / email / SMS (reuse the existing platform adapters: `createMetaWhatsAppAdapter`, `createTwilioSmsAdapter`, `createResendEmailAdapter`).
- Provider: self-service verified email → OTP → SMS chain. Admin manual path stays as the exceptional fallback.
- Token flow: single-use, short-lived, rate-limited (reuse the OTP-abuse rate-limit machinery), sessions revoked on reset.
- Client UI: web + mobile "forgot password" screens, all three locales, RTL-correct.
- Tests: full denial matrix, token expiry/single-use, rate-limit, and pin the new procedures (do not add unpinned procedures — F-07 is being fixed in Part 2).
- Add password recovery to the ADR-0031 launch checklist (it was omitted — the F-01 aggravator).

---

## Part 2 — Mediums (each its own named slice, this order)

### Slice 6 · F-06 — Branch protection

Enable protection on `main` via `gh api` (require PR + CI green; no direct pushes) — confirm with the owner before applying, it's a repo admin action. Then amend MM-PLAN-001 §3 #15 (stale justification) and MM-ARC-002 §10.2 (false claim) to state the true posture. Doc edits ride the same slice ADR.

### Slice 7 · F-07 + F-19 — Authz pinning across all routers

Replicate the clinical pinning pattern (denial matrix diffed against `router._def.procedures`) to billing, directory, identity, communication, ai, search, system, and booking/scheduling queries — all 106 procedures pinned, nothing hand-maintained without a failing mechanism. Includes the communication 4-entry denial matrix (F-19). Done when: a new unpinned procedure fails a test.

### Slice 8 · F-08 — Write-isolation guardrail

Per-module schema entrypoints in `@mesomed/db` + eslint boundaries element + a committed failing fixture proving the rule fires. Done when: module A importing module B's tables fails lint.

### Slice 9 · F-09 — Domain purity guardrail

`no-restricted-imports` allowlist for `packages/domain` (relative + `zod` + the two contracts subpaths, nothing else) + failing fixture.

### Slice 10 · F-10 — Adapter-ban real path

Split `@mesomed/platform` exports: interfaces entrypoint vs concrete adapters entrypoint; ban the concrete one (or the named concrete exports) outside the composition root; fixture on the **real** import path. Done when: importing `createTwilioSmsAdapter` in a module fails lint, and `app.ts` still passes.

### Slice 11 · F-11 — Statement timeouts

`statement_timeout`, `lock_timeout`, `idle_in_transaction_session_timeout` — set via new migration at the `mesomed_api` role level (values proposed in the slice ADR, owner approves). Pool-level fallback in `packages/db/src/client.ts`. Test that the settings are live.

### Slice 12 · F-12 — Clinical list bounds

Add limit/cursor inputs to `doctorEncounters`, `myEncounters`, `patientClinicalHistory`, `encounterNotes`; new migration replacing `clinical_read_encounters` with a LIMIT-honoring version (new function or CREATE OR REPLACE via new migration file — never edit `0004_clinical.sql`); audit rows written only for returned (not merely matched) encounters; kill the `readVisitNotes` N+1. Apply the standard hard-clamp.

### Slice 13 · F-13 — ar/ckb search normalization

Arabic/Sorani letter-form normalization (alef/yeh/kaf variants, diacritics strip, Arabic-Indic digit folding) applied identically at index time and query time in the search module. Ship as a normalization function in `packages/domain` (pure, heavily unit-tested with real ar/ckb fixtures) + reindex migration. This is the primary market — do not defer again.

### Slice 14 · F-14 — Mobile lib tests

Unit tests for `apps/mobile/lib/localized.ts` and `lib/media.ts` per the Testing DoD. Closes MM-QA-003 remediation item 4.

---

## Part 3 — Lows (bundles per the audit's own §5C guidance)

### Slice 15 (doc-only PR) · F-15 + F-17 + F-26 + F-27 + F-28

- F-17: reconcile MM-PLAN-001 §6 amendment log (ADRs 0012–0031 + the unlogged `084214e` edit).
- F-15: one-line Phase 3 lineage note wherever F-02 lineage is restated.
- F-26: `.env.example` — add the 2 webhook keys + 4 Phase 10 knobs; record the 948/126 gate count in the slice ADR.
- F-27: reword the two "marketplace service" comments.
- F-28: one-sentence F-02 note in ADR-0019.
- Also: delete/rename the stray `docs/\MM-QA-002-Full-System-Audit.md` (leading-backslash artifact).

### Slice 16 · F-16 — Cycle detection

Enable `import-x/no-cycle` in the shared eslint base + failing fixture. If enabling reveals existing cycles, report them to the owner before fixing.

### Slice 17 · F-18 — Directory events pin

`packages/contracts/test/directory-events.test.ts` mirroring the other four modules.

### Slice 18 · F-20 — Support-grant DB cap

New migration: 72 h max-window check inside `clinical_grant_support_access` (new migration file, not an edit); correct the overstating comment in `support-grant-policy.ts`.

### Slice 19 · F-22 + F-23 + F-24 — i18n trio (one named slice, three concerns, all i18n)

- F-22: RTL-aware chevrons on mobile booking week-nav (copy the `clinic.tsx` pattern).
- F-23: replace the 8 hardcoded placeholder literals (4 mobile + 4 web) with catalog keys in en/ar/ckb.
- F-24: port the mobile consumed-key test suite to `apps/web` (256 keys, liveness floor, en/ar/ckb presence).

### Slice 20 · F-25 — Seq-scan revisit trigger

Per-route search p95 panel in the api-latency dashboard + a `search_documents` row-count metric/alert at 50k; reconcile the threshold (pick one: ADR-0030's 100 ms; amend MM-ARC-002 §1.4 to match).

F-21: no action — recorded fact; rule 5 above is its institutionalization.

---

## Close-out (doc-only PR, last)

Dated ADR-0031 amendment: every MM-QA-004 finding listed with its closing PR number and merge commit; final gate counts recorded; statement that the remaining open items are exactly the human gates (deploy, HG-1..HG-5, translation/RTL reviews) — all owner-executed, none self-certified. Then run the full uncached gate one final time and report the counts.

## What stays with the owner (you prepare, never execute)

- Merging every PR (rule 9).
- Legal review of privacy policy + terms content (Slice 3b).
- Applying branch protection (Slice 6 — confirm first).
- Grafana/uptime-probe provisioning, store submission, deploy, HG-1..HG-5.
