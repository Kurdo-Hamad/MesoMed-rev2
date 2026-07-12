/**
 * One brand definition, two renderers (MM-PLAN-001 §1): these tokens feed
 * the web Tailwind theme and NativeWind directly. The Phase 8 premium pass
 * expands the Phase 0 seed into the full palette. Seed keys are kept
 * (mobile's Phase 0 screen reads `colors.*`); radius/type values are
 * refined here — the sanctioned moment for that is this pass.
 */

/** Brand teal ramp. `colors.brand` (the seed key) is the 700 step. */
export const brand = {
  50: "#F0FDFA",
  100: "#CCFBF1",
  200: "#99F6E4",
  300: "#5EEAD4",
  400: "#2DD4BF",
  500: "#14B8A6",
  600: "#0D9488",
  700: "#0F766E",
  800: "#115E59",
  900: "#134E4A",
} as const;

/** Warm neutral ramp (stone): comfortable under Arabic-script text blocks. */
export const neutral = {
  50: "#FAFAF9",
  100: "#F5F5F4",
  200: "#E7E5E4",
  300: "#D6D3D1",
  400: "#A8A29E",
  500: "#78716C",
  600: "#57534E",
  700: "#44403C",
  800: "#292524",
  900: "#1C1917",
} as const;

/** Featured/tier accents. */
export const accent = {
  featured: "#B45309",
  featuredSoft: "#FEF3C7",
} as const;

/** Semantic state colors, each with a soft surface variant. */
export const semantic = {
  success: "#16A34A",
  successSoft: "#DCFCE7",
  warning: "#D97706",
  warningSoft: "#FEF3C7",
  danger: "#DC2626",
  dangerSoft: "#FEE2E2",
  info: "#0284C7",
  infoSoft: "#E0F2FE",
} as const;

export const colors = {
  brand: brand[700],
  brandStrong: brand[800],
  brandSoft: brand[50],
  background: "#FFFFFF",
  backgroundDark: "#0B0F0E",
  surface: neutral[50],
  surfaceDark: "#131A18",
  foreground: "#0B0F0E",
  foregroundDark: "#F5F5F4",
  muted: "#6B7280",
  border: neutral[200],
  borderDark: "#2A3330",
} as const;

export const radii = {
  sm: 6,
  md: 10,
  lg: 16,
  xl: 24,
  full: 9999,
} as const;

/** Px sizes; web maps them to rem in the Tailwind theme. */
export const typeScale = {
  display: 40,
  title: 28,
  heading: 22,
  subtitle: 18,
  body: 16,
  small: 14,
  caption: 12,
} as const;

export const fontWeights = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
} as const;

/** Base-4 spacing scale (px). */
export const spacing = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
  20: 80,
} as const;

export const shadows = {
  card: "0 1px 3px rgba(28, 25, 23, 0.08), 0 1px 2px rgba(28, 25, 23, 0.04)",
  raised: "0 6px 16px rgba(28, 25, 23, 0.10), 0 2px 4px rgba(28, 25, 23, 0.05)",
  overlay: "0 16px 40px rgba(28, 25, 23, 0.18)",
} as const;

/** Motion durations (ms). */
export const durations = {
  fast: 120,
  base: 200,
  slow: 320,
} as const;
