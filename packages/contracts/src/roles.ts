/**
 * Platform roles per MM-PLAN-001 §5 Phase 2. The kernel authz middleware
 * guards procedures by role (§3.6 layer a); the full permission map and
 * role assignment flows land with the identity module in Phase 2.
 */
export const ROLES = ["patient", "doctor", "secretary", "admin"] as const;

export type Role = (typeof ROLES)[number];
