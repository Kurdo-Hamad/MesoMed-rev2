import { base } from "@mesomed/eslint-config";

export default [
  ...base,
  {
    // Metro loads its config via require(), so this file must stay CommonJS.
    files: ["metro.config.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        module: "writable",
        require: "readonly",
        __dirname: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
];
