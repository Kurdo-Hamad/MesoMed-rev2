import type { DevicePlatform } from "@mesomed/contracts/communication";

/**
 * Maps the runtime OS (react-native Platform.OS) to the wire enum
 * communication.registerDeviceToken accepts. Null = no push registration
 * on this platform (web preview, windows/macos targets) — the caller
 * skips silently. Deliberately imports NO react-native/expo types: their
 * global augmentations (fetch, AbortSignal, Timeout) would conflict with
 * @mesomed/platform and @mesomed/api under the node test tsconfig, and
 * this module is in the test graph via push.test.ts.
 */
export function devicePlatform(os: string): DevicePlatform | null {
  if (os === "ios" || os === "android") return os;
  return null;
}
