import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z, type ZodType } from "zod";
import type { AiGateway } from "@mesomed/platform";
import type { IdentityModule } from "../src/modules/identity/index.js";
import { createAppRouter } from "../src/trpc/router.js";

/**
 * Field-level mobile compatibility pin (ADR-0013's Phase 9 deferred item,
 * closing here): the path/kind pin (router-surface.test.ts) can't see a
 * new required input field or a removed output field — both strand
 * installed mobile clients. This test freezes the JSON-Schema shape of
 * every procedure the mobile app actually consumes and enforces
 * ADDITIVE-ONLY evolution against it:
 *
 * - input: an old client's payload (valid under the frozen schema) must
 *   stay valid — no new required property at any depth, no changed leaf
 *   type/constraints on a property the old client sends. Removing an
 *   input property is fine (zod strips unknown keys).
 * - output: an old client's reads must stay satisfiable — every frozen
 *   property survives at any depth with its frozen requiredness and leaf
 *   shape; new output properties are fine.
 *
 * Regenerate ONLY at a release cut (UPDATE_FROZEN_SURFACE=1, same knob
 * and rules as the path/kind pin — see docs/runbooks/release-cut-mobile.md);
 * regenerating to green a red pin is a review reject.
 */
const FROZEN_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "contracts",
  "frozen-schema-surface.json",
);

/**
 * Procedures the mobile app calls today — extend when a new screen
 * consumes a new procedure (generated from `grep -rhoE 'trpc\.[a-zA-Z]+\.
 * [a-zA-Z]+' apps/mobile/app apps/mobile/lib`; pinned literally here the
 * same way the authz MATRIX pins its list).
 */
const MOBILE_CONSUMED = [
  "ai.triageSymptoms",
  "booking.cancel",
  "booking.guestBook",
  "booking.myAppointments",
  "booking.weekAvailability",
  "clinical.addReportedMedication",
  "clinical.encounterNotes",
  "clinical.myClinicalRecord",
  "clinical.myEncounters",
  "clinical.removeReportedMedication",
  "clinical.upsertMedicalProfile",
  "communication.registerDeviceToken",
  "communication.unregisterDeviceToken",
  "directory.browseDoctors",
  "directory.browseFacilities",
  "directory.doctorDetail",
  "directory.facilityDetail",
  "directory.homepageFeed",
  "directory.listCategories",
  "directory.listCities",
  "directory.listSpecialties",
  "scheduling.doctorLocations",
  "search.listings",
] as const;

type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  anyOf?: JsonSchema[];
  [key: string]: unknown;
};

interface SchemaEntry {
  path: string;
  input: JsonSchema | null;
  output: JsonSchema | null;
}

function currentSchemaSurface(): SchemaEntry[] {
  // Router construction only wires closures — no dep is invoked, so
  // enumeration-only stubs are safe here (same rationale as the path pin).
  const router = createAppRouter({ auth: {} } as IdentityModule, {
    paymentGateways: {},
    ai: {} as AiGateway,
  });
  const procedures = router._def.procedures as unknown as Record<
    string,
    { _def: { inputs?: unknown[]; output?: unknown } }
  >;
  return MOBILE_CONSUMED.map((path) => {
    const procedure = procedures[path];
    if (!procedure) throw new Error(`mobile-consumed procedure missing from router: ${path}`);
    const input = procedure._def.inputs?.[0];
    const output = procedure._def.output;
    return {
      path,
      input: input
        ? (z.toJSONSchema(input as ZodType, { io: "input", unrepresentable: "any" }) as JsonSchema)
        : null,
      output: output
        ? (z.toJSONSchema(output as ZodType, {
            io: "output",
            unrepresentable: "any",
          }) as JsonSchema)
        : null,
    };
  });
}

const LEAF_KEYS_IGNORED = new Set(["properties", "required", "items", "description", "$schema"]);

/** Leaf-level shape (type, enum, format, constraints) must match exactly —
 * a changed type or tightened constraint breaks one direction or the other. */
function leafMismatch(frozen: JsonSchema, current: JsonSchema, at: string): string | null {
  const keys = new Set([...Object.keys(frozen), ...Object.keys(current)]);
  for (const key of keys) {
    if (LEAF_KEYS_IGNORED.has(key)) continue;
    if (JSON.stringify(frozen[key]) !== JSON.stringify(current[key])) {
      return `${at}: '${key}' changed (${JSON.stringify(frozen[key])} -> ${JSON.stringify(current[key])})`;
    }
  }
  return null;
}

/** Old payloads (valid under `frozen`) must stay valid under `current`. */
function inputIssues(frozen: JsonSchema, current: JsonSchema, at: string): string[] {
  const issues: string[] = [];
  const mismatch = leafMismatch(frozen, current, at);
  if (mismatch) issues.push(mismatch);

  const frozenProps = frozen.properties ?? {};
  const currentProps = current.properties ?? {};
  const frozenRequired = new Set(frozen.required ?? []);
  for (const name of current.required ?? []) {
    if (!frozenRequired.has(name)) {
      issues.push(`${at}.${name}: new REQUIRED input property (old clients don't send it)`);
    }
  }
  for (const [name, frozenProp] of Object.entries(frozenProps)) {
    const currentProp = currentProps[name];
    // Property removed from input: old clients still send it, zod strips it.
    if (currentProp) issues.push(...inputIssues(frozenProp, currentProp, `${at}.${name}`));
  }
  if (frozen.items && current.items) {
    issues.push(...inputIssues(frozen.items, current.items, `${at}[]`));
  }
  return issues;
}

/** Old clients' reads (per `frozen`) must stay satisfiable under `current`. */
function outputIssues(frozen: JsonSchema, current: JsonSchema, at: string): string[] {
  const issues: string[] = [];
  const mismatch = leafMismatch(frozen, current, at);
  if (mismatch) issues.push(mismatch);

  const frozenProps = frozen.properties ?? {};
  const currentProps = current.properties ?? {};
  const currentRequired = new Set(current.required ?? []);
  for (const name of frozen.required ?? []) {
    if (!currentRequired.has(name)) {
      issues.push(`${at}.${name}: frozen output property no longer required`);
    }
  }
  for (const [name, frozenProp] of Object.entries(frozenProps)) {
    const currentProp = currentProps[name];
    if (!currentProp) {
      issues.push(`${at}.${name}: frozen output property removed`);
      continue;
    }
    issues.push(...outputIssues(frozenProp, currentProp, `${at}.${name}`));
  }
  if (frozen.items && current.items) {
    issues.push(...outputIssues(frozen.items, current.items, `${at}[]`));
  }
  return issues;
}

function allIssues(frozen: SchemaEntry[], current: SchemaEntry[]): string[] {
  const byPath = new Map(current.map((entry) => [entry.path, entry]));
  const issues: string[] = [];
  for (const entry of frozen) {
    const now = byPath.get(entry.path);
    if (!now) {
      issues.push(`${entry.path}: procedure gone from the mobile-consumed pin`);
      continue;
    }
    if (entry.input && now.input) issues.push(...inputIssues(entry.input, now.input, entry.path));
    if (entry.input && !now.input) issues.push(`${entry.path}: input schema removed`);
    if (entry.output && now.output) {
      issues.push(...outputIssues(entry.output, now.output, entry.path));
    }
    if (entry.output && !now.output) issues.push(`${entry.path}: output schema removed`);
  }
  return issues;
}

describe("frozen schema surface (field-level additive-only pin, ADR-0013)", () => {
  const surface = currentSchemaSurface();

  it("keeps every mobile-consumed input/output schema additively compatible", () => {
    if (process.env["UPDATE_FROZEN_SURFACE"] === "1") {
      writeFileSync(FROZEN_PATH, `${JSON.stringify(surface, null, 2)}\n`);
    }
    const frozen = JSON.parse(readFileSync(FROZEN_PATH, "utf8")) as SchemaEntry[];
    expect(allIssues(frozen, surface)).toEqual([]);
  });

  it("meta-test: a new required input property fires the pin", () => {
    const frozen = JSON.parse(readFileSync(FROZEN_PATH, "utf8")) as SchemaEntry[];
    const target = frozen.find((entry) => entry.path === "booking.guestBook")!;
    const mutated: SchemaEntry = JSON.parse(JSON.stringify(target));
    mutated.input!.properties!["newField"] = { type: "string" };
    mutated.input!.required = [...(mutated.input!.required ?? []), "newField"];
    const issues = inputIssues(target.input!, mutated.input!, target.path);
    expect(issues.some((issue) => issue.includes("new REQUIRED input property"))).toBe(true);
  });

  it("meta-test: a removed output field fires the pin", () => {
    const frozen = JSON.parse(readFileSync(FROZEN_PATH, "utf8")) as SchemaEntry[];
    const target = frozen.find((entry) => entry.path === "booking.myAppointments")!;
    const mutated: SchemaEntry = JSON.parse(JSON.stringify(target));
    // appointments[] items lose a field the old client renders.
    const items = mutated.output!.properties!["appointments"]!.items!;
    const [firstProp] = Object.keys(items.properties!);
    delete items.properties![firstProp!];
    const issues = outputIssues(target.output!, mutated.output!, target.path);
    expect(issues.some((issue) => issue.includes("removed"))).toBe(true);
  });

  it("meta-test: a nested ADDITIVE output field does NOT fire the pin", () => {
    const frozen = JSON.parse(readFileSync(FROZEN_PATH, "utf8")) as SchemaEntry[];
    const target = frozen.find((entry) => entry.path === "booking.myAppointments")!;
    const widened: SchemaEntry = JSON.parse(JSON.stringify(target));
    const items = widened.output!.properties!["appointments"]!.items!;
    items.properties!["brandNewOptionalField"] = { type: "string" };
    expect(outputIssues(target.output!, widened.output!, target.path)).toEqual([]);
  });
});
