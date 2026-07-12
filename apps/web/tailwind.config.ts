import {
  accent,
  brand,
  colors,
  durations,
  neutral,
  radii,
  semantic,
  shadows,
  typeScale,
} from "@mesomed/ui-tokens";
import type { Config } from "tailwindcss";

const px = (value: number) => `${value / 16}rem`;

/**
 * The Tailwind theme is generated from packages/ui-tokens — the single
 * brand definition both renderers consume (MM-PLAN-001 §1). Never restate
 * a hex value here; extend the tokens package instead.
 */
export default {
  theme: {
    extend: {
      colors: {
        brand: {
          ...brand,
          DEFAULT: colors.brand,
          soft: colors.brandSoft,
          strong: colors.brandStrong,
        },
        neutral,
        featured: { DEFAULT: accent.featured, soft: accent.featuredSoft },
        success: { DEFAULT: semantic.success, soft: semantic.successSoft },
        warning: { DEFAULT: semantic.warning, soft: semantic.warningSoft },
        danger: { DEFAULT: semantic.danger, soft: semantic.dangerSoft },
        info: { DEFAULT: semantic.info, soft: semantic.infoSoft },
        surface: { DEFAULT: colors.surface, dark: colors.surfaceDark },
        canvas: { DEFAULT: colors.background, dark: colors.backgroundDark },
        ink: { DEFAULT: colors.foreground, dark: colors.foregroundDark },
        line: { DEFAULT: colors.border, dark: colors.borderDark },
      },
      borderRadius: {
        sm: px(radii.sm),
        md: px(radii.md),
        lg: px(radii.lg),
        xl: px(radii.xl),
      },
      fontSize: {
        display: px(typeScale.display),
        title: px(typeScale.title),
        heading: px(typeScale.heading),
        subtitle: px(typeScale.subtitle),
        body: px(typeScale.body),
        small: px(typeScale.small),
        caption: px(typeScale.caption),
      },
      boxShadow: {
        card: shadows.card,
        raised: shadows.raised,
        overlay: shadows.overlay,
      },
      transitionDuration: {
        fast: `${durations.fast}ms`,
        base: `${durations.base}ms`,
        slow: `${durations.slow}ms`,
      },
      fontFamily: {
        sans: ["var(--font-latin)", "var(--font-arabic)", "system-ui", "sans-serif"],
      },
    },
  },
} satisfies Config;
