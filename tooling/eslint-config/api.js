// @ts-check
import boundaries from "eslint-plugin-boundaries";
import { base } from "./base.js";

/**
 * Enforces MM-PLAN-001 §3.1 (module data isolation) and §3.8 (adapters):
 * a vertical-slice module may not import another module's internals, and
 * domain/business code may not import concrete platform adapters directly.
 */
export const apiConfig = [
  ...base,
  {
    plugins: { boundaries },
    settings: {
      "boundaries/elements": [
        { type: "module", pattern: "apps/api/src/modules/*", capture: ["module"] },
        { type: "kernel", pattern: "apps/api/src/kernel/*" },
        { type: "platform", pattern: "packages/platform/src/*" },
        { type: "domain", pattern: "packages/domain/src/*" },
      ],
    },
    rules: {
      "boundaries/no-unknown": "off",
      "boundaries/element-types": [
        "error",
        {
          default: "allow",
          rules: [
            {
              from: "module",
              disallow: ["module"],
              importKind: "value",
              message:
                "Cross-module writes must go through domain events; cross-module reads must use published query functions (MM-PLAN-001 §3.1). Direct imports between modules/*/ are not allowed except via router composition in server.ts.",
            },
          ],
        },
      ],
    },
  },
];

export default apiConfig;
