import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";
import type { Linter } from "eslint";
import { apiConfig } from "../api.js";

/**
 * Meta-tests: prove the architecture guardrails actually fire (MM-QA-001
 * F-01). Each fixture is a deliberate violation of (or a deliberate
 * allowance in) MM-PLAN-001 §3.1 / §3.8. If a config change silently
 * disables a guardrail, these tests fail — a guardrail without a meta-test
 * is indistinguishable from no guardrail.
 */
const fixtureRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "api-app");

async function lintFixture(relativeFile: string) {
  const eslint = new ESLint({
    cwd: fixtureRoot,
    overrideConfigFile: true,
    overrideConfig: apiConfig as Linter.Config[],
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
