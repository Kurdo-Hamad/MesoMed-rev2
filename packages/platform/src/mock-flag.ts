/**
 * Mock-adapter detection (MM-PLAN-001 §5 Phase 7 guardrail): every mock
 * adapter in this package carries `isMock: true`. The composition root
 * uses this to refuse booting in production with any mock wired.
 */
export function isMockAdapter(adapter: unknown): boolean {
  return (
    typeof adapter === "object" &&
    adapter !== null &&
    (adapter as { isMock?: unknown }).isMock === true
  );
}
