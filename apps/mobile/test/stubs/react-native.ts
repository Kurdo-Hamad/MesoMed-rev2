// Minimal react-native surface for running the Better Auth Expo plugin
// under node vitest — only the device APIs the plugin touches.
export const Platform = { OS: "ios" };
export const AppState = {
  currentState: "active",
  addEventListener: () => ({ remove: () => undefined }),
};
