// @ts-check
import boundaries from "eslint-plugin-boundaries";
import { base } from "./base.js";

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
              disallow: [
                { to: { element: { types: "module" } }, dependency: { kind: "value" } },
              ],
              message:
                "Cross-module writes must go through domain events; cross-module reads must use published query functions (MM-PLAN-001 §3.1).",
            },
            {
              from: { element: { types: "kernel" } },
              disallow: [
                { to: { element: { types: "module" } }, dependency: { kind: "value" } },
              ],
              message:
                "The kernel is shared infrastructure and must not depend on business modules (MM-PLAN-001 §2).",
            },
          ],
        },
      ],
    },
  },
  {
    // The composition root is the one place concrete platform adapters are
    // wired (MM-PLAN-001 §3.8).
    files: ["src/app.ts", "src/composition/**"],
    rules: { "no-restricted-imports": "off" },
  },
];

export default apiConfig;
