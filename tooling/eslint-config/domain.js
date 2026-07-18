// @ts-check
import { base, platformAdapterRestriction } from "./base.js";

/**
 * packages/domain holds PURE logic only (MM-PLAN-001 repo layout): state
 * machines, slot engine, tier rules, triage utils. Purity is enforced as an
 * import allowlist (MM-QA-004 F-09): relative paths, `zod`, and the two
 * contracts subpaths domain rules are written against. Everything else —
 * other workspace packages, node builtins, any third-party module — is
 * banned. Test files additionally use `vitest`.
 */
const ALLOWED_CONTRACTS_SUBPATHS = ["@mesomed/contracts/phone", "@mesomed/contracts/booking"];

const PURITY_MESSAGE =
  "packages/domain is pure logic (MM-PLAN-001 repo layout): only relative imports, zod, and " +
  ALLOWED_CONTRACTS_SUBPATHS.join("/") +
  " are allowed. No node builtins, no platform, no db, no I/O.";

/**
 * The full `no-restricted-imports` options for domain files. Built per
 * override because flat-config rule entries replace, not merge — the
 * *.test.ts override must restate the whole allowlist to add `vitest`.
 *
 * Pattern groups use gitignore semantics (the `ignore` package), where an
 * excluded parent directory blocks re-including its children (the Slice 8
 * `@mesomed/db` lesson). Hence three independent groups, each shaped so its
 * negations sit at a level whose parent is not excluded, plus a `paths`
 * entry for the exact `@mesomed/contracts` root specifier that no group can
 * ban without also excluding the allowed subpaths' parent.
 *
 * @param {string[]} allowedBareModules bare module specifiers to allow
 */
function domainImportRestrictions(allowedBareModules) {
  return {
    paths: [{ name: "@mesomed/contracts", message: PURITY_MESSAGE }],
    patterns: [
      {
        // All bare modules (single- and multi-segment, incl. `node:*`).
        // Relative specifiers are re-included explicitly: gitignore `*`
        // matches the leading "." segment, which would otherwise exclude
        // the parent of every "./x.js" import. The @mesomed scope is
        // re-included wholesale here and restricted by the groups below.
        group: [
          "*",
          "*/**",
          ...allowedBareModules.map((m) => `!${m}`),
          "!.",
          "!..",
          "!./**",
          "!../**",
          "!@mesomed",
          "!@mesomed/**",
        ],
        message: PURITY_MESSAGE,
      },
      {
        // Every @mesomed package except the contracts subtree (handled
        // below). Negating at the `@mesomed/contracts` level keeps the
        // allowed subpaths' parent unexcluded.
        group: ["@mesomed/*", "!@mesomed/contracts"],
        message: PURITY_MESSAGE,
      },
      {
        // Contracts subpaths: allowed ones are siblings of the banned
        // ones, so their negation is not blocked by a parent exclusion.
        group: ["@mesomed/contracts/*", ...ALLOWED_CONTRACTS_SUBPATHS.map((m) => `!${m}`)],
        message: PURITY_MESSAGE,
      },
    ],
  };
}

export const domainConfig = [
  ...base,
  {
    rules: {
      "no-restricted-imports": ["error", domainImportRestrictions(["zod"])],
    },
  },
  {
    files: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": ["error", domainImportRestrictions(["zod", "vitest"])],
    },
  },
  {
    // Config files (eslint.config.js, vitest.config.ts, …) are tooling, not
    // domain logic — they keep only the base platform-adapter restriction.
    files: ["**/*.config.{js,ts,mjs,cjs}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [platformAdapterRestriction] }],
    },
  },
];

export default domainConfig;
