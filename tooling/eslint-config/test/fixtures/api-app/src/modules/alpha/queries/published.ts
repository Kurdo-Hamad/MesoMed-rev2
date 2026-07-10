// A module's published query surface (MM-PLAN-001 §3.1): the queries/
// folder is the sanctioned cross-module READ entrypoint.
export function listAlphaThings(): number[] {
  return [1, 2, 3];
}
