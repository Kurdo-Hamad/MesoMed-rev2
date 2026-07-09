import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts"],
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
