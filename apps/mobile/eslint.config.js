import { base } from "@mesomed/eslint-config";

export default [
  ...base,
  {
    // Metro/Babel/Tailwind all load these via require(), so they must stay CommonJS.
    files: ["metro.config.js", "babel.config.cjs", "tailwind.config.js"],
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
