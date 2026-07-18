import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";
import type { Linter } from "eslint";
import { domainConfig } from "../domain.js";

/**
 * Meta-tests for the packages/domain purity guardrail (MM-QA-004 F-09):
 * pure logic imports nothing but relative paths, zod, and the two allowed
 * contracts subpaths. A guardrail without a meta-test is indistinguishable
 * from no guardrail (MM-QA-001 F-01).
 */
const fixtureRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "domain-pkg",
);

async function lintFixture(relativeFile: string) {
  const eslint = new ESLint({
    cwd: fixtureRoot,
    overrideConfigFile: true,
    overrideConfig: domainConfig as Linter.Config[],
  });
  const results = await eslint.lintFiles([relativeFile]);
  const result = results[0];
  if (!result) throw new Error(`No lint result for ${relativeFile}`);
  return result;
}

function ruleIds(result: ESLint.LintResult): (string | null)[] {
  return result.messages.map((m) => m.ruleId);
}

describe("domain purity (MM-PLAN-001 repo layout, MM-QA-004 F-09)", () => {
  it("rejects importing @mesomed/db", async () => {
    const result = await lintFixture("imports-db.ts");
    expect(result.errorCount).toBeGreaterThan(0);
    expect(ruleIds(result)).toContain("no-restricted-imports");
  });

  it("rejects importing @mesomed/platform", async () => {
    const result = await lintFixture("imports-platform.ts");
    expect(result.errorCount).toBeGreaterThan(0);
    expect(ruleIds(result)).toContain("no-restricted-imports");
  });

  it("rejects importing a node builtin", async () => {
    const result = await lintFixture("imports-node-builtin.ts");
    expect(result.errorCount).toBeGreaterThan(0);
    expect(ruleIds(result)).toContain("no-restricted-imports");
  });

  it("allows zod, the two contracts subpaths, and relative imports", async () => {
    const result = await lintFixture("imports-zod-and-contracts.ts");
    expect(result.errorCount).toBe(0);
  });
});
