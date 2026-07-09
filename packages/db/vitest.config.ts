import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Integration tests provision a real Postgres per file (Testcontainers
    // image pull or embedded-binary initdb on first run can be slow).
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
