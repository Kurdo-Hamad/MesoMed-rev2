import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { locales as catalogs } from "@mesomed/i18n";
import { routing } from "./routing";

/**
 * Messages come straight from the shared trilingual catalogs
 * (packages/i18n) — the web app never carries its own strings
 * (MM-PLAN-001 §3.10).
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  return { locale, messages: catalogs[locale] };
});
