# ADR-0001 — Locked Stack & Phase 0 Foundation

**Status:** Accepted
**Date:** 2026-07-09
**Phase:** 0 — Foundation

## Context

MM-PLAN-001 §1 locks the MesoMed rebuild stack: Turborepo + pnpm workspaces, Fastify + tRPC v11 single BFF, Zod v4 contracts, PostgreSQL via Drizzle, Better Auth, pg-boss, Next.js web, Expo mobile, and a set of adapter-backed cross-cutting concerns (AI, search, storage, email, push, WhatsApp, payments) — explicitly rejecting event sourcing, microservices, separate web/mobile BFFs, Redis at launch, and NestJS. This ADR records that decision as executed, plus the concrete choices and deviations made while scaffolding Phase 0.

## Decision

Adopt the stack as specified in MM-PLAN-001 §1, scaffolded per the repository layout in §2. Phase 0 delivers tooling, a health-check-only API, and hello screens on web/mobile — no business modules (§5, Phase 0).

## Deviations from the plan text

1. **Package/toolchain versions were not pinned to the exact ones implied by the plan's authoring date.** The plan names majors (tRPC v11, Zod v4, Next.js "latest stable") without exact minors. At scaffold time (2026-07-09) the actual latest-stable versions on the npm registry were checked directly and used, notably:
   - TypeScript `~6.0.3` (not 5.x) — matched to the version Expo's own SDK 57 template pins, since mixing TS majors between `apps/mobile` and the rest of the monorepo risked tooling incompatibility. TypeScript 7 exists on the registry but is new enough that Expo has not adopted it yet; deferred until the ecosystem catches up.
   - Expo SDK 57 / React Native 0.86 / React 19.2.x — resolved via the official `create-expo-app` generator rather than hand-authored, to avoid guessing an incompatible peer-dependency set for a fast-moving native toolchain.
   - ESLint 10, typescript-eslint 8.x, Fastify 5.10, tRPC 11.18, Zod 4.4 — this ADR captures these as a snapshot; `pnpm-lock.yaml` is the source of truth going forward.
2. **Node runtime:** the development machine has Node v24.18.0 installed, not Node 22 LTS as locked in §1. `engines.node` is set to `>=22.11.0` (permissive, not narrowly pinned) so local installs aren't blocked, `.nvmrc` pins `22`, and CI (`actions/setup-node`) pins exactly Node 22 — so the _target_ runtime for CI/production is Node 22 LTS as locked, while local dev tooling tolerates the newer installed runtime. No Node-22-specific API was required in Phase 0 code.
3. **Package manager bootstrap:** pnpm was not preinstalled on the dev machine and `corepack enable` failed with EPERM (no write access to the global Node install under `Program Files` without elevation). Installed pnpm globally via `npm install -g pnpm` instead. `packageManager` field in root `package.json` still pins the intended pnpm version for reproducibility.
4. **Internal package build strategy:** `packages/*` (contracts, db, domain, config, platform, i18n, ui-tokens) ship as raw TypeScript source (`exports` pointing at `./src/*.ts`) rather than pre-compiled `dist/`, consumed directly by each app's own toolchain (Next.js `transpilePackages`, Metro via `metro.config.js` pnpm-symlink resolution, and `apps/api` bundled through `tsup` with `noExternal: [/^@mesomed\//]`). This avoids wiring a `tsc --build` project-reference graph for seven packages with no publishing requirement, while `apps/api`'s Docker image still ships a single self-contained `dist/server.js` per the plan's portability requirement (§1, CI/CD row).
5. **`tooling/typescript-config/react-native.json` was dropped** in favor of `apps/mobile/tsconfig.json` extending `expo/tsconfig.base` directly. A shared config extending `expo/tsconfig.base` from `tooling/typescript-config` cannot resolve `expo` under pnpm's isolated `node_modules` linking (the package doing the extending has no `expo` dependency of its own), so the indirection would have broken at typecheck time.
6. **`node-linker=hoisted` set repo-wide in `.npmrc`.** pnpm's default isolated linking (per-package symlinked `node_modules`) doesn't expose several of Expo/Metro's _peer_ dependencies (`@expo/log-box`, `expo-modules-core`, etc.) to the packages that `require()` them at runtime during static web rendering — Metro's resolver assumes an npm/yarn-classic flat tree. This is Expo's own documented recommendation for pnpm monorepos, not a MesoMed-specific workaround. Verified: `apps/mobile`'s Expo Router web build was broken under isolated linking (`Unable to resolve module expo-modules-core`, `@expo/log-box`) and boots clean under hoisted linking. This applies to the whole workspace, not just `apps/mobile` — re-tested lint/typecheck/test/build across every package after the switch and the gate stayed green.

## Consequences

- Exact dependency versions live in `pnpm-lock.yaml`, not hand-maintained in this ADR; this ADR documents the _reasoning_ for the choices made at scaffold time, not a version manifest to keep in sync.
- Future phases that add real TypeScript-7 tooling support, Node 22-specific runtime code, or a published-package build pipeline should record that as a new ADR rather than editing this one.
