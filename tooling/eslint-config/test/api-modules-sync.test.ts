import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { API_MODULES } from "../api.js";

/**
 * MM-QA-005 F-04: `API_MODULES` (api.js) is the hand-maintained list the
 * F-08 write-isolation guardrail (MM-PLAN-001 §3.1) walks — its own
 * comment concedes "keep in sync with the filesystem", but nothing failed
 * when it drifted. A module directory missing from this list has its
 * `@mesomed/db` imports unguarded, silently. This meta-test closes the
 * class: it reads apps/api/src/modules/ directly and asserts equality.
 */
const API_MODULES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "apps",
  "api",
  "src",
  "modules",
);

describe("API_MODULES stays in sync with apps/api/src/modules (MM-QA-005 F-04)", () => {
  it("matches the filesystem exactly", () => {
    const onDisk = readdirSync(API_MODULES_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect([...API_MODULES].sort()).toEqual(onDisk);
  });
});
