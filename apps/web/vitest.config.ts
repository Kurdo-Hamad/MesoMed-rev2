import { defineConfig } from "vitest/config";

// Scoped to test/ — the Playwright e2e specs (e2e/*.spec.ts) run under
// their own runner and must never be picked up by vitest's defaults.
export default defineConfig({
  // Next's tsconfig sets jsx: preserve (the Next compiler transforms it);
  // under vitest, the transformer must do it itself.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    include: ["test/**/*.test.{ts,tsx}"],
    globalSetup: ["test/global-setup.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
