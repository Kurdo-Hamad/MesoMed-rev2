import { isRtl, type Locale } from "@mesomed/i18n";

/**
 * React Native's RTL is a global native setting (I18nManager), not a
 * per-node `dir` attribute like web's logical properties (convention #10)
 * — it only takes effect after a reload. True when the current native
 * layout direction doesn't match the target locale. Kept free of any
 * react-native import so it's testable under plain Node (see locale.tsx,
 * the only caller, for the I18nManager/reload side effects).
 */
export function needsRtlReload(locale: Locale, currentIsRTL: boolean): boolean {
  return isRtl(locale) !== currentIsRTL;
}
