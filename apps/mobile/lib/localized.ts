import type { Locale } from "@mesomed/i18n";

export interface LocalizedText {
  en: string;
  ar: string;
  ckb: string;
}

/**
 * Localized fields arrive with all three locales so switching locale never
 * refetches (contracts "Directory"). Optional columns may hold "" for a
 * locale — fall back ckb → ar → en in platform-default order. Mirrors
 * apps/web/lib/localized.ts exactly (same wire shape, same fallback order).
 */
export function pickText(text: LocalizedText, locale: Locale): string {
  return text[locale] || text.ckb || text.ar || text.en;
}

export function pickOptionalText(text: LocalizedText | null, locale: Locale): string | null {
  if (!text) return null;
  return pickText(text, locale) || null;
}
