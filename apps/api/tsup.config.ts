import { defineConfig } from "tsup";

export default defineConfig({
  // main.ts sequences instrumentation before the server via dynamic imports;
  // esbuild code-splitting preserves those as separate chunks (ADR-0002).
  entry: ["src/main.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // Bundle first-party workspace packages (they ship raw TS source); leave
  // every third-party dependency external so Node resolves it normally
  // from node_modules at runtime.
  noExternal: [/^@mesomed\//],
});
