/**
 * Deterministic UUIDs with a recognizable seed prefix (ported convention
 * from the old pipeline): stable across databases and re-runs, valid v4
 * shape, and visually distinguishable from organic rows.
 *
 * Block map (one hex char): a=countries · b=cities · c=categories/section
 * types (keeps the old n offsets) · d=facilities · e=specialties ·
 * f=doctor profiles · 0=promotions · 1=symptoms · 2=procedures.
 */
export function seedUuid(block: string, n: number): string {
  return `00000000-0000-4000-9${block}00-${String(n).padStart(12, "0")}`;
}
