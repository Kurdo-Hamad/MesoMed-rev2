/**
 * Platform locale codes (MM-PLAN-001 §1: en / ar / ckb, ckb default).
 * This is the contract clients and the API share (request headers, user
 * preferences); the message catalogs themselves live in `packages/i18n`,
 * which type-asserts that every locale here has a catalog.
 */
export const LOCALES = ["en", "ar", "ckb"] as const;

export type Locale = (typeof LOCALES)[number];

/** ckb (Central Kurdish/Sorani) is the platform default per MM-PLAN-001 §1. */
export const DEFAULT_LOCALE: Locale = "ckb";

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}
