// @ts-check
import boundaries from "eslint-plugin-boundaries";
import { base, platformAdapterRestriction } from "./base.js";

/**
 * apps/api's vertical-slice module directories (src/modules/*). Adding a
 * module without listing it here leaves that module's @mesomed/db imports
 * unguarded — keep in sync with the filesystem.
 */
const API_MODULES = [
  "ai",
  "billing",
  "booking",
  "clinical",
  "communication",
  "directory",
  "identity",
  "scheduling",
  "search",
];

/**
 * Table-level enforcement of MM-PLAN-001 §3.1 (MM-QA-004 F-08): files in
 * src/modules/<m> may import @mesomed/db only through their own
 * `@mesomed/db/modules/<m>` entrypoint or the table-free
 * `@mesomed/db/core` — never the root hub (all tables) and never another
 * module's entrypoint. Applies to type imports too: the allow-list is
 * path-based, not import-kind-based. Exported so the meta-test can run the
 * real generator against fixture module names.
 *
 * Flat-config rule entries replace rather than merge, so each override
 * re-includes the base platform-adapter restriction.
 *
 * @param {string[]} moduleNames
 */
export function dbIsolationOverrides(moduleNames) {
  return moduleNames.map((moduleName) => ({
    files: [`src/modules/${moduleName}/**`],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          // The exact root specifier must be banned via `paths`: a
          // gitignore-style `group` entry of "@mesomed/db" would also match
          // every subpath, and the parent-directory rule then blocks
          // re-including "!@mesomed/db/modules/<m>".
          paths: [
            {
              name: "@mesomed/db",
              message: `The @mesomed/db root hub re-exports every module's tables. A module reaches tables only through its own entrypoint: import from "@mesomed/db/modules/${moduleName}" (client/operators: "@mesomed/db/core") — MM-PLAN-001 §3.1.`,
            },
          ],
          patterns: [
            platformAdapterRestriction,
            {
              group: [
                "@mesomed/db/migrate",
                "@mesomed/db/testing",
                "@mesomed/db/modules/*",
                `!@mesomed/db/modules/${moduleName}`,
              ],
              message: `Another module's tables are off-limits: cross-module reads go through published query functions, cross-module writes through domain events (MM-PLAN-001 §3.1). A module's own tables come from "@mesomed/db/modules/${moduleName}".`,
            },
          ],
        },
      ],
    },
  }));
}

/**
 * Enforces MM-PLAN-001 §3.1 (module data isolation): vertical-slice modules
 * may not value-import each other's internals, and the kernel may not reach
 * into business modules. §3.8 (adapter discipline) is enforced by the
 * `no-restricted-imports` ban in base.js, lifted below for the composition
 * root only.
 *
 * These guardrails are proven live by test/boundaries.test.ts (MM-QA-001
 * F-01: a guardrail without a meta-test is indistinguishable from no
 * guardrail). If you change this file, that meta-test must still pass.
 */
export const apiConfig = [
  ...base,
  {
    plugins: { boundaries },
    settings: {
      // Patterns are matched relative to the linted package root (ESLint
      // runs with cwd = apps/api), not the repository root.
      "boundaries/elements": [
        // A module's queries/ folder is its PUBLISHED cross-module read
        // surface (§3.1: "cross-module reads happen via published query
        // functions"). Listed before "module" — first match wins — so
        // query files classify as module-query and stay value-importable
        // from other modules, while everything else in the module doesn't.
        {
          type: "module-query",
          pattern: "src/modules/*/queries/**/*",
          // "file" is soft-deprecated in v7 but still the only way to
          // classify individual files under a captured folder; revisit on
          // the plugin's v8 migration.
          mode: "file",
          capture: ["module"],
        },
        { type: "module", pattern: "src/modules/*", capture: ["module"] },
        // No trailing glob: kernel files live directly in src/kernel/, and a
        // folder-mode `src/kernel/*` would only classify its subfolders.
        { type: "kernel", pattern: "src/kernel" },
      ],
      // The codebase uses NodeNext-style `.js`-suffixed imports of TS
      // sources; boundaries can only classify what this resolver resolves.
      "import/resolver": {
        typescript: { alwaysTryTypes: true },
      },
    },
    rules: {
      "boundaries/no-unknown": "off",
      "boundaries/dependencies": [
        "error",
        {
          default: "allow",
          policies: [
            {
              from: { element: { types: "module" } },
              disallow: [{ to: { element: { types: "module" } }, dependency: { kind: "value" } }],
              message:
                "Cross-module writes must go through domain events; cross-module reads must use published query functions (MM-PLAN-001 §3.1).",
            },
            {
              // Being a published query licenses being imported — not
              // reaching into ANOTHER module's internals ("{{ from.module }}" is
              // the importing file's captured module name).
              from: { element: { types: "module-query" } },
              disallow: [
                {
                  to: {
                    element: { types: "module", captured: { module: "!{{ from.module }}" } },
                  },
                  dependency: { kind: "value" },
                },
              ],
              message:
                "Published queries may serve other modules but must not value-import another module's internals (MM-PLAN-001 §3.1).",
            },
            {
              from: { element: { types: "kernel" } },
              disallow: [
                {
                  to: { element: { types: { anyOf: ["module", "module-query"] } } },
                  dependency: { kind: "value" },
                },
              ],
              message:
                "The kernel is shared infrastructure and must not depend on business modules (MM-PLAN-001 §2).",
            },
          ],
        },
      ],
    },
  },
  ...dbIsolationOverrides(API_MODULES),
  {
    // The composition root is the one place concrete platform adapters are
    // wired (MM-PLAN-001 §3.8).
    files: ["src/app.ts", "src/composition/**"],
    rules: { "no-restricted-imports": "off" },
  },
];

export default apiConfig;
