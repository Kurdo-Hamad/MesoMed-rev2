import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MOBILE_CONSUMED } from "./contracts/mobile-consumed.js";

/**
 * MM-QA-005 F-01: `MOBILE_CONSUMED` (router-schema-surface.test.ts) is
 * hand-maintained and drifted silently — a mobile screen calling a new
 * procedure was never added to the pin, so a breaking change to that
 * procedure would have passed ADR-0013's compat gate undetected. This
 * meta-test makes that class of drift fail CI directly: it re-derives the
 * mobile-consumed set from mobile source (the same `grep -rhoE
 * 'trpc\.[a-zA-Z]+\.[a-zA-Z]+'` the pin's own header describes) and
 * asserts set-equality against the pinned list.
 */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SCAN_DIRS = [
  join(REPO_ROOT, "apps", "mobile", "app"),
  join(REPO_ROOT, "apps", "mobile", "lib"),
];
const TRPC_CALL_PATTERN = /trpc\.([a-zA-Z]+)\.([a-zA-Z]+)/g;

function listFilesRecursive(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? listFilesRecursive(full) : [full];
  });
}

function mobileConsumedFromSource(): Set<string> {
  const consumed = new Set<string>();
  for (const dir of SCAN_DIRS) {
    for (const file of listFilesRecursive(dir)) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(TRPC_CALL_PATTERN)) {
        consumed.add(`${match[1]}.${match[2]}`);
      }
    }
  }
  return consumed;
}

describe("mobile-consumed procedure pin stays in sync with mobile source (MM-QA-005 F-01)", () => {
  it("MOBILE_CONSUMED is exactly the set of trpc.<router>.<procedure> calls in apps/mobile", () => {
    const fromSource = mobileConsumedFromSource();
    const pinned = new Set<string>(MOBILE_CONSUMED);

    const missingFromPin = [...fromSource].filter((path) => !pinned.has(path)).sort();
    const staleInPin = [...pinned].filter((path) => !fromSource.has(path)).sort();

    expect(
      missingFromPin,
      "mobile calls these procedures but MOBILE_CONSUMED doesn't pin them",
    ).toEqual([]);
    expect(staleInPin, "MOBILE_CONSUMED pins these but mobile no longer calls them").toEqual([]);
  });
});
