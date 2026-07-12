# ADR-0013 — Mobile API Compatibility Policy

**Status:** Accepted
**Phase:** 8 (obligation per MM-ARC-002 §1.3, restated in the Phase 8
kickoff instruction, now committed at docs/governance/MM-ARC-002-Strategic-Architecture-Package.md).
**Builds on:** ADR-0003 (kernel, config service, typed error codes),
convention #3 (event contracts are forever — this ADR extends the same
discipline to procedure contracts), convention #9 (config over code).

## Problem

`apps/mobile` will ship binaries that cannot be hot-fixed. Once a released
mobile client consumes a tRPC procedure, changing that procedure's name,
kind, or wire shape strands installed clients. Web deploys atomically with
the API; mobile does not.

## Decision

1. **Additive-only procedure contracts once mobile consumes them.**
   Adding procedures, adding _optional_ input fields, and adding output
   fields are allowed. Removing/renaming a procedure, changing its
   query/mutation kind, making an optional input required, or removing an
   output field is a **breaking change**, and a breaking change ships as a
   **new procedure name** (`booking.guestBookV2`-style); the old procedure
   stays until version adoption allows removal, tracked against the
   minimum supported version below.

2. **Minimum supported version is config, not code** (convention #9).
   The `mobile.compat` row in `config_entries` (schema
   `mobileCompatSchema` in `packages/config`: `{ minSupportedVersion:
"major.minor.patch" }`) is the single knob. Kernel middleware on the
   base procedure (`apps/api/src/kernel/app-version.ts`, wired in
   `kernel/trpc.ts` so every procedure inherits it before authz) reads
   `x-app-version` and answers the typed `UPGRADE_REQUIRED`
   (HTTP 412 PRECONDITION_FAILED) below the minimum. Deliberate
   asymmetries:
   - **No header → no gate.** Web and server-to-server traffic never
     send the header and are never gated.
   - **No config row → no gate.** Enforcement is opt-in per deployment.
   - **Malformed header → fail open.** The policy targets known outdated
     clients; blocking unknowns would gate debug/curl traffic and buys no
     safety (a hostile client can send any header it likes).

3. **CI pins the previous-release surface.**
   `apps/api/test/contracts/frozen-router-surface.json` is a snapshot of
   every procedure path + kind (105 at freeze), generated from the real
   root router. `test/router-surface.test.ts` fails CI when any frozen
   procedure disappears or changes kind, with meta-tests proving the pin
   detects both regressions. The file is regenerated **only at a release
   cut** (`UPDATE_FROZEN_SURFACE=1 vitest run test/router-surface.test.ts`)
   — regenerating to green a red pin defeats its purpose and is a review
   reject.

## Scope deferred to Phase 9 (mobile DoD)

- Schema-level input/output compatibility checking (the pin currently
  freezes path + kind; field-level additive verification joins when the
  mobile client snapshot is real).
- The mobile client actually sending `x-app-version` and rendering the
  upgrade screen on `UPGRADE_REQUIRED`.
- The release-cut checklist step that regenerates the frozen surface.

## Rejected

- **Gating by default with a hardcoded minimum** — violates config-over-
  code and would brick local/dev clients.
- **URL-versioned API (`/v2/trpc`)** — tRPC procedure-level additivity is
  strictly cheaper for a modular monolith; whole-surface versioning forces
  lockstep migration of untouched modules.
