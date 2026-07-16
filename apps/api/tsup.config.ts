import { defineConfig } from "tsup";

export default defineConfig({
  // main.ts sequences instrumentation before the server via dynamic imports;
  // esbuild code-splitting preserves those as separate chunks (ADR-0002).
  // seed-load ships as a second entry so the Phase 10 load-test seeder can
  // run co-located with a scratch database (ADR-0030); it refuses
  // NODE_ENV=production and is never invoked by dist/main.js.
  entry: { main: "src/main.ts", "seed-load": "scripts/seed/seed-load.ts" },
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
