import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// MM-QA-003 F-07 regression guard (Phase 9c Slice 3): the web clinic page
// carried hardcoded status→actions maps (DOCTOR_ACTIONS/SECRETARY_ACTIONS)
// that this slice deleted in favor of the server-computed allowedActions.
// This suite statically proves no web code path reintroduces the pattern:
// no status-keyed action map exists anywhere in web source, and the clinic
// page derives its buttons from allowedActions through the known-action
// filter. Grouping rows BY status is layout, not an action rule (MM-DES-002
// §3) — only status→action derivation is forbidden.

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_DIRS = ["app", "components", "lib"];

/** Each pattern is a way a client could re-encode "what actions does this
 * status permit" — the exact class allowedActions exists to eliminate. */
const FORBIDDEN_PATTERNS: Array<{ re: RegExp; why: string }> = [
  {
    re: /DOCTOR_ACTIONS|SECRETARY_ACTIONS/,
    why: "the deleted hardcoded role/status action maps",
  },
  {
    re: /Record<\s*AppointmentStatus/,
    why: "a status-keyed map (the F-07 anti-pattern's shape)",
  },
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe("no web code path maps a status to actions locally (F-07)", () => {
  const files = SOURCE_DIRS.flatMap((dir) => sourceFiles(join(WEB_ROOT, dir)));

  it("scans a real source tree", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("finds no status→actions mapping anywhere in web source", () => {
    const violations = files.flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return FORBIDDEN_PATTERNS.filter((pattern) => pattern.re.test(source)).map(
        (pattern) => `${relative(WEB_ROOT, file)}: matches ${pattern.re} (${pattern.why})`,
      );
    });
    expect(violations).toEqual([]);
  });

  it("the clinic page renders actions from server allowedActions through the known-action filter", () => {
    const page = readFileSync(
      join(WEB_ROOT, "app", "[locale]", "dashboard", "clinic", "page.tsx"),
      "utf8",
    );
    expect(page).toContain("allowedActions.filter(isKnownAction)");
  });
});
