/**
 * Deterministic UUIDs with a recognizable seed prefix (ported convention
 * from the old pipeline): stable across databases and re-runs, valid v4
 * shape, and visually distinguishable from organic rows.
 *
 * Block map (one hex char): a=countries · b=cities (b11–b19 = multicountry
 * expansion) · c=categories/section types (keeps the old n offsets;
 * c11–c13 = section types, c21–c28 = expansion categories) · d=facilities
 * (d1–d30 original, d31–d62 expansion) · e=specialties · f=doctor profiles
 * · 0=promotions · 1=symptoms · 2=procedures.
 */
export function seedUuid(block: string, n: number): string {
  return `00000000-0000-4000-9${block}00-${String(n).padStart(12, "0")}`;
}
