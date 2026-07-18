import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";
import type { Linter } from "eslint";
import { apiConfig, dbIsolationOverrides } from "../api.js";

/**
 * Meta-tests: prove the architecture guardrails actually fire (MM-QA-001
 * F-01). Each fixture is a deliberate violation of (or a deliberate
 * allowance in) MM-PLAN-001 §3.1 / §3.8. If a config change silently
 * disables a guardrail, these tests fail — a guardrail without a meta-test
 * is indistinguishable from no guardrail.
 */
const fixtureRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "api-app");

async function lintFixture(relativeFile: string, config: unknown[] = apiConfig) {
  const eslint = new ESLint({
    cwd: fixtureRoot,
    overrideConfigFile: true,
    overrideConfig: config as Linter.Config[],
  });
  const results = await eslint.lintFiles([relativeFile]);
  const result = results[0];
  if (!result) throw new Error(`No lint result for ${relativeFile}`);
  return result;
}

function ruleIds(result: ESLint.LintResult): (string | null)[] {
  return result.messages.map((m) => m.ruleId);
}

describe("module isolation (MM-PLAN-001 §3.1)", () => {
  it("rejects a cross-module value import (.js-suffixed NodeNext specifier)", async () => {
    const result = await lintFixture("src/modules/beta/cross-module-value-import.ts");
    expect(result.errorCount).toBeGreaterThan(0);
    expect(ruleIds(result)).toContain("boundaries/dependencies");
  });

  it("allows a cross-module type-only import", async () => {
    const result = await lintFixture("src/modules/beta/cross-module-type-import.ts");
    expect(result.errorCount).toBe(0);
  });

  it("allows a module to import kernel infrastructure", async () => {
    const result = await lintFixture("src/modules/beta/uses-kernel.ts");
    expect(result.errorCount).toBe(0);
  });

  it("rejects the kernel value-importing a business module", async () => {
    const result = await lintFixture("src/kernel/uses-module.ts");
    expect(result.errorCount).toBeGreaterThan(0);
    expect(ruleIds(result)).toContain("boundaries/dependencies");
  });
});

describe("published query surface (MM-PLAN-001 §3.1)", () => {
  it("allows a module to value-import another module's published queries", async () => {
    const result = await lintFixture("src/modules/beta/uses-module-query.ts");
    expect(result.errorCount).toBe(0);
  });

  it("rejects a published query reaching into another module's internals", async () => {
    const result = await lintFixture("src/modules/alpha/queries/reaches-into-module.ts");
    expect(result.errorCount).toBeGreaterThan(0);
    expect(ruleIds(result)).toContain("boundaries/dependencies");
  });
});

describe("table-level module isolation (MM-PLAN-001 §3.1, MM-QA-004 F-08)", () => {
  // The real generator run against the fixture module names, appended the
  // same way api.js appends dbIsolationOverrides(API_MODULES).
  const config = [...apiConfig, ...dbIsolationOverrides(["alpha", "beta"])];

  it("rejects a module importing another module's db entrypoint", async () => {
    const result = await lintFixture("src/modules/beta/writes-alpha-table.ts", config);
    expect(result.errorCount).toBeGreaterThan(0);
    expect(ruleIds(result)).toContain("no-restricted-imports");
  });

  it("rejects a module importing the @mesomed/db root hub", async () => {
    const result = await lintFixture("src/modules/beta/uses-db-root.ts", config);
    expect(result.errorCount).toBeGreaterThan(0);
    expect(ruleIds(result)).toContain("no-restricted-imports");
  });

  it("allows a module importing its own db entrypoint", async () => {
    const result = await lintFixture("src/modules/beta/uses-own-db.ts", config);
    expect(result.errorCount).toBe(0);
  });

  it("allows a module importing the table-free @mesomed/db/core", async () => {
    const result = await lintFixture("src/modules/beta/uses-db-core.ts", config);
    expect(result.errorCount).toBe(0);
  });

  it("keeps the adapter ban alive inside the per-module override", async () => {
    // Flat-config rule entries replace rather than merge — the override must
    // re-include the base platform-adapter restriction, or module files
    // would silently lose it.
    const result = await lintFixture("src/modules/beta/uses-adapter.ts", config);
    expect(result.errorCount).toBeGreaterThan(0);
    expect(ruleIds(result)).toContain("no-restricted-imports");
  });
});

describe("adapter discipline (MM-PLAN-001 §3.8)", () => {
  it("rejects module code importing a concrete platform adapter", async () => {
    const result = await lintFixture("src/modules/beta/uses-adapter.ts");
    expect(result.errorCount).toBeGreaterThan(0);
    expect(ruleIds(result)).toContain("no-restricted-imports");
  });

  it("allows the composition root to import concrete adapters", async () => {
    const result = await lintFixture("src/app.ts");
    expect(result.errorCount).toBe(0);
  });
});
