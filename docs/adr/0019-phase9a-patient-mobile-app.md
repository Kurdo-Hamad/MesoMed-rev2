# ADR-0019 — Phase 9a: Patient-Facing Mobile App (close-out)

**Status:** Accepted
**Phase:** 9a (MM-PLAN-001 §5 Phase 9, narrowed to the patient-facing
Expo app; Phase 9b — doctor/secretary queue views — is explicitly
deferred scope, not started).
**Companions:** ADR-0018 (Slice 0: toolchain, hoisted-linker posture,
RTL sign-off relocation), ADR-0013 (mobile API compatibility policy —
its three Phase 9 deferred items all close in this phase), MM-DEC rev02
(auth/identity, implemented exactly; see the biometrics decision below).

## What shipped (slices 0–6, each branch → PR → CI green → merge)

0. Toolchain gate (PR #22, ADR-0018): verified `nodeLinker: hoisted`
   posture, mobile bundle build in CI, RTL sign-off resolved by owner.
1. App shell (PR #24): Expo Router, use-intl on the shared i18n
   catalogs with an RTL bootstrap (global `I18nManager` + one-time
   reload — RN has no per-node `dir`), NativeWind theme generated from
   ui-tokens, tRPC client sending `x-app-version` with a blocking
   UpgradeRequiredScreen on the typed `UPGRADE_REQUIRED` — closing
   ADR-0013 deferred items 1–2 of the mobile DoD.
2. Browse/search (PR #25): homepage, directory + category/doctor
   browse (keyset), doctor/facility detail, FTS search + symptom triage
   with red-flag banner — same published queries as web, zero new API
   surface; `COUNTRY_COMING_SOON` renders a full-screen coming-soon
   state through the same typed-appCode plumbing as the upgrade gate.
3. Guest booking (PR #26): MM-DEC §1/§2 exactly — no account, no OTP;
   phone normalized client-side via `@mesomed/contracts/phone`;
   `SLOT_UNAVAILABLE` handled as UX (slot clears, availability
   refetches) off the typed appCode, never message strings; the
   optional-account offer appears after booking, never before.
4. Auth (PR #27): patient phone+password sign-in with no login OTP
   (§4); sign-up with WhatsApp OTP where verification claims the
   phone-keyed guest profile in one transaction (§2) — proven by a new
   integration test driving the REAL mobile client against a live API;
   persistent sessions in expo-secure-store restore across relaunch;
   the tRPC link attaches the stored session cookie (native fetch has
   no cookie jar). Patient-only: providers stay on the web dashboards.
5. Dashboard + push (PR #28): appointments with optimistic cancel,
   health record (ADR-0010 separation intact; visit notes absent from
   self-view), READ-ONLY encounters with notes/amendment badges (the
   doctor composers are 9b), and push token register/unregister on the
   Phase 7 `communication.registerDeviceToken` API — dev/mock path, no
   production EXPO_PUSH_ACCESS_TOKEN required, token failures degrade
   silently to WhatsApp/SMS per MM-DEC §6.
6. Release rails + e2e (PR #29): field-level schema pin (below), EAS
   build/update config as files only, Maestro flows, release-cut
   runbook (`docs/runbooks/release-cut-mobile.md`).

Final counts: mobile 5 test files / 15 tests; api 60 files / 548 tests
(includes the 4 new schema-pin tests); full workspace 20/20 lint+
typecheck tasks, 10/10 test tasks serialized, 3/3 builds — every slice
gated from WSL then CI-green on its PR (runs 29275261261, 29281869172,
29287421435, 29289473932, 29291531164, 29293379969, 29295976892).

## Decisions of record

- **Biometric unlock is EXCLUDED — owner decision 2026-07-14.** The
  phase instruction said to build biometric unlock citing MM-DEC §4,
  but MM-DEC rev02 §4 states "Biometric authentication is **not** part
  of this strategy in the current scope" and its change note lists
  "biometrics are removed". The contradiction was surfaced per
  CLAUDE.md's locked-document rule; the owner chose to ship Slice 4
  without biometrics rather than amend MM-DEC. Adding it later is a
  MM-DEC rev03 amendment first, code second.
- **Field-level compatibility pin** (`apps/api/test/
router-schema-surface.test.ts` + `frozen-schema-surface.json`)
  closes ADR-0013's third deferred item: the input/output JSON Schemas
  (zod 4 `z.toJSONSchema`) of the 23 mobile-consumed procedures are
  frozen; evolution must be additive (new required input property,
  removed/de-required output property, or a changed leaf shape at any
  depth fails CI; nested additive fields pass without pin churn).
  Meta-tests prove all three firing modes. Regeneration shares the
  path-pin's `UPDATE_FROZEN_SURFACE=1` release-cut-only knob; the
  consumed-procedure list is pinned literally and extended in the same
  PR that makes a screen consume a new procedure.
- **The web `web.*` i18n namespace is reused directly** for shared
  product copy (same keys, all three locales); only genuinely
  mobile-specific UI adds `mobile.*` keys (upgradeRequired, comingSoon,
  account). One catalog, two renderers — no forked translations.
- **Metro `.js`-specifier rule:** files in the Metro graph must import
  workspace-relative modules extension-less; NodeNext-style `.js`
  specifiers only survive in node-only files (tests). Hit twice
  (Slice 1 rtl, Slice 4 auth-client); recorded so it stops recurring.
- **RN/expo type-globals containment:** react-native and
  expo-notifications type roots augment global fetch/AbortSignal/
  Timeout and break @mesomed/platform + @mesomed/api compilation when
  pulled into the mobile package's node test tsconfig. Modules shared
  with the test graph must not import RN/expo types
  (`lib/push-platform.ts` pattern).

## Deviations / carry-ins (convention #14)

1. **Maestro flows are authored, not executed** (ADR-0004 #14
   precedent): this WSL dev box has no Android emulator or iOS device.
   The three flows (guest booking, sign-in + relaunch session restore,
   dashboard) assert ckb catalog strings and live in
   `apps/mobile/.maestro/`. Execution happens at the on-device human
   gate below.
2. **Remaining HUMAN gates — not self-certified:** Maestro flows on a
   physical device/emulator, push round-trip on physical devices, and
   TestFlight / Play-internal builds + store submission (per
   `docs/runbooks/release-cut-mobile.md` §5). Status: **ready for human
   gate: device verification.**
3. **Mobile RTL visual review deferred by explicit owner decision
   (2026-07-13, ADR-0016 items 9–10 amendment):** the owner approved
   the existing web RTL evidence as-is and deferred regeneration to a
   future Kurdish date-formatting effort; mobile screens follow the
   same catalogs and logical-properties discipline, and their visual
   RTL review rides the same deferred review — deferred, not skipped.
4. **Patient reschedule UI remains deferred** (ADR-0016 carry-in #4):
   mobile mirrors web — cancel + find-a-doctor, no reschedule surface.
5. **`normalizePhone` has no test coverage anywhere** (pre-existing
   `packages/contracts` gap, flagged in Slice 3) — carry-in, not
   absorbed into a mobile-scoped branch.
6. **Note on test timing (flaky policy, MM-ARC-002 §3.7):** one
   `@mesomed/api` test task failure occurred in a single
   workspace-serialized turbo run during the Slice 6 gate. The failing
   test's name was lost: the run's output was piped through `tail`, and
   the next run overwrote turbo's per-package log before it was read.
   Not reproducible — three consecutive forced serialized full-suite
   runs plus a standalone full api run, all green. Gate-run output is
   now tee'd to files so any recurrence is named. This stays open as an
   observation, not quarantined-and-forgotten: if it recurs, the
   captured log turns it into a named, root-causeable defect.
7. **Push round-trip verified only to the registration boundary**: the
   token lands via the Phase 7 API against mock adapters; real Expo
   push delivery is part of the device-verification human gate.

8.  **Offline-tolerant browsing (cached queries) deferred — owner
   decision 2026-07-14 (MM-QA-003 F-01):** MM-PLAN-001 §5 Phase 9
   lists "offline-tolerant browsing (cached queries) verified" as a
   gate item. It was not implemented in slices 0–6: the mobile query
   client is plain in-memory with no persistence, and the gap was
   absent from this ADR's original shipped/deviation lists. Rather
   than bolt persistence onto a merged phase, the owner defers it to
   its own future slice (Phase 9b or later) with proper tests. This
   gate item is formally waived for the 9a close-out; it must be
   re-raised before any phase certifies offline capability.

## Phase 9b (deferred scope)

Doctor/secretary mobile queue views — clinic-day lists, check-in flow,
walk-in booking — were explicitly out of scope for 9a and remain
unstarted. The web dashboards stay the provider surface until 9b is
scheduled.
