import en from "./messages/en.json" with { type: "json" };
import ar from "./messages/ar.json" with { type: "json" };
import ckb from "./messages/ckb.json" with { type: "json" };
import { DEFAULT_LOCALE, type Locale } from "@mesomed/contracts/i18n";

/** ckb (Central Kurdish/Sorani) is the platform default per MM-PLAN-001 §1. */
export const defaultLocale: Locale = DEFAULT_LOCALE;

// `satisfies` proves at compile time that every platform locale declared in
// @mesomed/contracts/i18n has a message catalog here — the two can't drift.
export const locales = { en, ar, ckb } as const satisfies Record<Locale, unknown>;

export type { Locale };

export const rtlLocales: readonly Locale[] = ["ar", "ckb"];

export function isRtl(locale: Locale): boolean {
  return rtlLocales.includes(locale);
}

export function textDirection(locale: Locale): "rtl" | "ltr" {
  return isRtl(locale) ? "rtl" : "ltr";
}

export type Messages = typeof en;

export { formatLocalizedDate, formatNumericDate, pinLtr } from "./format-date";
