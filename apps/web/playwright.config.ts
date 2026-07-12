import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

/**
 * Phase 8 e2e suite (§3.7): drives the production web build against the
 * dev-embedded API harness — real composition root, embedded Postgres,
 * seeded directory + E2E fixtures (see scripts/seed/seed-e2e.ts). Specs
 * assert UI text through the i18n catalogs, never hardcoded strings
 * (convention #10), and run the booking flow in all three locales.
 */
const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // The suite mutates shared server state (approvals, payments) — one
  // worker keeps flows deterministic; specs are already coarse-grained.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["github"]] : [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "pnpm --filter @mesomed/api dev:embedded",
      cwd: repoRoot,
      url: "http://localhost:4000/health",
      timeout: 420_000,
      reuseExistingServer: !process.env.CI,
      env: { E2E_FIXTURES: "1", PORT: "4000" },
      stdout: "pipe",
    },
    {
      // rm .next first: the Next data cache persists across runs and would
      // serve a PREVIOUS harness's responses (e.g. an already-visible
      // doctor) into a fresh database's suite.
      command:
        "rm -rf apps/web/.next && pnpm --filter @mesomed/web build && pnpm --filter @mesomed/web start",
      cwd: repoRoot,
      url: "http://localhost:3000/en",
      timeout: 420_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
