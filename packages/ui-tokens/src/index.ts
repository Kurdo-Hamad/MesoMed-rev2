/**
 * One brand definition, two renderers (MM-PLAN-001 §1): these tokens feed
 * the web Tailwind theme and NativeWind directly. The full brand palette
 * lands with the Phase 8 premium pass — Phase 0 ships a minimal seed so
 * both clients can render a consistent hello screen today.
 */
export const colors = {
  brand: "#0F766E",
  background: "#FFFFFF",
  backgroundDark: "#0B0F0E",
  foreground: "#0B0F0E",
  foregroundDark: "#F5F5F4",
  muted: "#6B7280",
} as const;

export const radii = {
  sm: 4,
  md: 8,
  lg: 16,
} as const;

export const typeScale = {
  title: 28,
  subtitle: 16,
} as const;
