import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AiGateway } from "@mesomed/platform";
import type { IdentityModule } from "../src/modules/identity/index.js";
import { createAppRouter } from "../src/trpc/router.js";

/**
 * Mobile API compatibility pin (Phase 8, MM-ARC-002 §1.3): the frozen
 * previous-release client surface must remain callable — procedures are
 * additive-only once mobile consumes them; a breaking change is a NEW
 * procedure name, the old one kept until adoption allows removal.
 *
 * `frozen-router-surface.json` is the snapshot of the router surface at
 * the last release cut. Regenerate it ONLY when cutting a release
 * (UPDATE_FROZEN_SURFACE=1 vitest run test/router-surface.test.ts) —
 * regenerating to make a red test green defeats the pin. Schema-level
 * input/output compatibility enforcement deepens in Phase 9 (DoD).
 */
const FROZEN_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "contracts",
  "frozen-router-surface.json",
);

interface SurfaceEntry {
  path: string;
  type: string;
}

function currentSurface(): SurfaceEntry[] {
  // Router construction only wires closures — no dep is invoked, so
  // enumeration-only stubs are safe here (and only here).
  const router = createAppRouter({ auth: {} } as IdentityModule, {
    paymentGateways: {},
    ai: {} as AiGateway,
  });
  const procedures = router._def.procedures as Record<string, unknown>;
  return Object.entries(procedures)
    .map(([path, procedure]) => ({
      path,
      type: (procedure as { _def: { type: string } })._def.type,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

describe("frozen router surface (additive-only contract pin)", () => {
  const surface = currentSurface();

  it("keeps every frozen previous-release procedure callable with the same kind", () => {
    if (process.env["UPDATE_FROZEN_SURFACE"] === "1") {
      writeFileSync(FROZEN_PATH, `${JSON.stringify(surface, null, 2)}\n`);
    }
    const frozen = JSON.parse(readFileSync(FROZEN_PATH, "utf8")) as SurfaceEntry[];
    const byPath = new Map(surface.map((entry) => [entry.path, entry.type]));

    const missing = frozen.filter((entry) => !byPath.has(entry.path));
    const retyped = frozen.filter(
      (entry) => byPath.has(entry.path) && byPath.get(entry.path) !== entry.type,
    );

    expect(missing, "procedures removed/renamed after the frozen release").toEqual([]);
    expect(retyped, "procedures changed kind after the frozen release").toEqual([]);
  });

  it("meta-test: the pin detects a removed procedure", () => {
    const frozen = JSON.parse(readFileSync(FROZEN_PATH, "utf8")) as SurfaceEntry[];
    expect(frozen.length).toBeGreaterThan(0);
    const mutilated = new Map(surface.map((entry) => [entry.path, entry.type]));
    mutilated.delete(frozen[0]!.path);
    const missing = frozen.filter((entry) => !mutilated.has(entry.path));
    expect(missing).toHaveLength(1);
  });

  it("meta-test: the pin detects a query/mutation kind flip", () => {
    const frozen = JSON.parse(readFileSync(FROZEN_PATH, "utf8")) as SurfaceEntry[];
    const first = frozen[0]!;
    const flipped = new Map(surface.map((entry) => [entry.path, entry.type]));
    flipped.set(first.path, first.type === "query" ? "mutation" : "query");
    const retyped = frozen.filter(
      (entry) => flipped.has(entry.path) && flipped.get(entry.path) !== entry.type,
    );
    expect(retyped.length).toBeGreaterThan(0);
  });
});
