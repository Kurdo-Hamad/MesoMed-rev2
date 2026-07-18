// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import importX from "eslint-plugin-import-x";
import prettier from "eslint-config-prettier";

/**
 * MM-PLAN-001 §3.8: only the apps/api composition root wires concrete
 * adapters (api.js lifts this there). Everything else — modules, kernel,
 * domain, clients — imports adapter interfaces from @mesomed/platform's
 * root entrypoint. Exported because flat-config rule entries replace, not
 * merge: api.js's per-module `no-restricted-imports` overrides must
 * re-include this pattern or module files would silently lose the ban.
 */
export const platformAdapterRestriction = {
  // The exact entrypoint plus any subpath (gitignore semantics: a matched
  // directory bans its contents too) — MM-QA-004 F-10 moved the concrete
  // vendor factories to this real path; the root keeps interfaces + mocks.
  group: ["@mesomed/platform/adapters"],
  message:
    "Concrete platform adapters may only be wired in the apps/api composition root (src/app.ts, src/composition/**) — MM-PLAN-001 §3.8. Import the adapter interface from @mesomed/platform instead.",
};

/** Base ESLint flat config shared by every workspace package/app. */
export const base = tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/.expo/**",
      "**/node_modules/**",
      "**/coverage/**",
    ],
  },
  {
    plugins: { "import-x": importX },
    // import-x v4 reads its own settings namespace (the legacy
    // "import/resolver" key is honored by eslint-plugin-boundaries'
    // resolve util, not by import-x) — without this, resolution-dependent
    // rules like no-cycle silently skip unresolved imports (MM-QA-004
    // F-16; verified empirically).
    settings: {
      "import-x/resolver": { typescript: { alwaysTryTypes: true } },
      // no-cycle must parse the IMPORTED files too; without an explicit
      // parser mapping import-x cannot build export maps for .ts targets
      // under flat config, and cycle detection silently finds nothing.
      "import-x/parsers": { "@typescript-eslint/parser": [".ts", ".tsx"] },
    },
    rules: {
      // The workspace uses node-linker=hoisted (Expo/Metro constraint,
      // ADR-0001 §6), so undeclared imports resolve fine locally and then
      // explode in the prod-pruned Docker image. Fail them at lint time
      // instead (MM-QA-001 F-17).
      // Convention #13 "no barrel-file cycles" detection (MM-QA-004 F-16,
      // ADR-0049): a cycle anywhere in the import graph fails lint. The
      // resolver only follows project-internal files, so cost stays
      // proportional to each workspace.
      "import-x/no-cycle": ["error", { maxDepth: 8 }],
      "import-x/no-extraneous-dependencies": [
        "error",
        {
          devDependencies: [
            "**/test/**",
            "**/*.test.ts",
            // Playwright e2e suite (Phase 8) — dev-only by construction.
            "**/e2e/**",
            "**/*.spec.ts",
            "**/*.config.{js,ts,mjs,cjs}",
            "**/eslint.config.js",
            // Test harnesses shipped as package entrypoints (e.g.
            // @mesomed/db/testing) may import test-only providers
            // (testcontainers, embedded-postgres); production entrypoints
            // never import from src/testing, so these stay devDependencies.
            "**/src/testing/**",
          ],
        },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "no-restricted-imports": ["error", { patterns: [platformAdapterRestriction] }],
    },
  },
);

export default base;
