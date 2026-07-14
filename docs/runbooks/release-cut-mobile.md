# Runbook — Mobile Release Cut

The mobile app ships binaries that cannot be hot-fixed (ADR-0013). A
release cut is the ONLY moment the frozen compatibility pins move, and
the only flow that produces store builds. Everything here is manual and
owner-authorized; nothing in it runs in CI or autonomously.

## 1. Regenerate the frozen compatibility pins

Both pins snapshot the surface the release's clients will depend on.
Regenerating them at any other time — in particular, to green a red CI
pin — is a review reject (ADR-0013).

From WSL (`~/mesomed`), on the release branch, after the full gate is
green:

```bash
cd apps/api
UPDATE_FROZEN_SURFACE=1 pnpm exec vitest run test/router-surface.test.ts test/router-schema-surface.test.ts
```

- `test/contracts/frozen-router-surface.json` — every procedure path +
  kind (the Phase 8 pin).
- `test/contracts/frozen-schema-surface.json` — input/output JSON
  Schemas of the mobile-consumed procedures (the Phase 9a field-level
  pin; the consumed list is pinned in `router-schema-surface.test.ts` —
  extend it in the same PR that makes a mobile screen consume a new
  procedure).

Commit both regenerated files in the release PR. Review the diff: it
should contain exactly the additive changes shipped since the last cut.

## 2. Bump the app version

`apps/mobile/app.json` → `expo.version` (the client sends it as
`x-app-version`; the kernel gate compares it against the `mobile.compat`
config row). `runtimeVersion.policy: "appVersion"` ties EAS Update
compatibility to the same number.

## 3. Build (EAS)

Profiles are in `apps/mobile/eas.json`; builds require the owner's Expo
account (interactive login — never store credentials in the repo):

```bash
cd apps/mobile
eas build --profile preview --platform all    # internal validation build
eas build --profile production --platform all # store build
```

## 4. OTA updates (EAS Update)

JS-only changes between store releases ship over the air to the channel
matching the build profile:

```bash
eas update --channel production --message "<release note>"
```

An OTA update never changes `x-app-version` — anything that alters API
compatibility (new procedure consumption, native module changes) needs a
store build and a pin regeneration, not an update.

## 5. Store submission — HUMAN GATE

TestFlight / Play internal track uploads, store metadata (en/ar/ckb),
and production rollout are owner actions (`eas submit`). Claude Code
stops at "ready for human gate: device verification" — push round-trip
and biometric-free session restore are verified ON PHYSICAL DEVICES
before any rollout widens (Phase 9a gate).

## 6. After rollout

- Set/raise the `mobile.compat` `minSupportedVersion` config row ONLY
  after adoption data says stranded-version traffic is acceptable —
  raising it force-upgrades every older client (ADR-0013: no config row,
  no gate).
- Old procedures kept for the previous release can be scheduled for
  removal once the minimum supported version no longer calls them.
