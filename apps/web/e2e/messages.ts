/**
 * Catalog-backed assertion strings (convention #10): specs assert what the
 * UI would render in each locale by reading the same catalogs the app
 * renders from — a hardcoded expectation string in a spec is a bug.
 */
import { locales, type Locale } from "@mesomed/i18n";

export const LOCALES: readonly Locale[] = ["en", "ar", "ckb"];

type WebMessages = (typeof locales)["en"]["web"];

export function web(locale: Locale): WebMessages {
  return (locales[locale] as (typeof locales)["en"]).web;
}

/** ICU-lite: replace {name} placeholders for exact-text assertions. */
export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? `{${key}}`);
}
