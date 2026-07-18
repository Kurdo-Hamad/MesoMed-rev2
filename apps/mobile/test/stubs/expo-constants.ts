/** Vitest stub for expo-constants (aliased in vitest.config.ts and mapped
 * in tsconfig.test.json — the test program types against what actually
 * runs). Widened shape so consumers' optional chains typecheck. */
const constants: { expoConfig?: { extra?: Record<string, unknown> } } = {
  expoConfig: { extra: {} },
};
export default constants;
