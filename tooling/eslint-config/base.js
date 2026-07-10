// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import importX from "eslint-plugin-import-x";
import prettier from "eslint-config-prettier";

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
    rules: {
      // The workspace uses node-linker=hoisted (Expo/Metro constraint,
      // ADR-0001 §6), so undeclared imports resolve fine locally and then
      // explode in the prod-pruned Docker image. Fail them at lint time
      // instead (MM-QA-001 F-17).
      "import-x/no-extraneous-dependencies": [
        "error",
        {
          devDependencies: [
            "**/test/**",
            "**/*.test.ts",
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
      // MM-PLAN-001 §3.8: only the apps/api composition root wires concrete
      // adapters (api.js lifts this there). Everything else — modules,
      // kernel, domain, clients — imports adapter interfaces from
      // @mesomed/platform's root entrypoint.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@mesomed/platform/adapters/*"],
              message:
                "Concrete platform adapters may only be wired in the apps/api composition root (MM-PLAN-001 §3.8). Import the adapter interface from @mesomed/platform instead.",
            },
          ],
        },
      ],
    },
  },
);

export default base;
