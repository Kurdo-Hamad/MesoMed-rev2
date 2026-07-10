import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The Better Auth Expo plugin imports device APIs (react-native,
// expo-constants, expo-linking) that don't exist under node. The stubs
// shim ONLY those surfaces; the plugin's actual behavior under test —
// cookie capture, secure-store persistence, sign-out clearing — is real.
export default defineConfig({
  resolve: {
    alias: {
      "react-native": fileURLToPath(new URL("./test/stubs/react-native.ts", import.meta.url)),
      "expo-constants": fileURLToPath(new URL("./test/stubs/expo-constants.ts", import.meta.url)),
      "expo-linking": fileURLToPath(new URL("./test/stubs/expo-linking.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    server: {
      deps: {
        // Must be bundled by vite (not externalized to node) so the
        // react-native/expo aliases above apply to its imports.
        inline: [/@better-auth\/expo/],
      },
    },
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
