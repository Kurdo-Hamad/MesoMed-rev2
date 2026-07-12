import { defineRouting } from "next-intl/routing";

/**
 * Locale-prefixed routing (MM-PLAN-001 §3.10): every page lives under
 * /en, /ar or /ckb — ckb is the platform default, matching the API's
 * DEFAULT_LOCALE. `localePrefix: "always"` keeps URLs explicit for SEO
 * alternates and shareability.
 */
export const routing = defineRouting({
  locales: ["en", "ar", "ckb"],
  defaultLocale: "ckb",
  localePrefix: "always",
});
