const {
  accent,
  brand,
  colors,
  neutral,
  radii,
  semantic,
  typeScale,
} = require("@mesomed/ui-tokens");

const px = (value) => `${value}px`;

/**
 * The Tailwind theme is generated from packages/ui-tokens — the single
 * brand definition both renderers consume (MM-PLAN-001 §1). Mirrors
 * apps/web/tailwind.config.ts's color mapping; boxShadow/transitionDuration
 * are skipped here (no RN elevation/animation usage yet — add when a
 * component actually needs it).
 *
 * @type {import('tailwindcss').Config}
 */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
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
    },
  },
};
