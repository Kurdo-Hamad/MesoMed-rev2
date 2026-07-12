/**
 * Trilingual notification template registry (MM-PLAN-001 §5 Phase 7,
 * ported semantics from the rev01 `notifications/templates.ts` salvage,
 * extended for push/email variants). Message text lives in the
 * `@mesomed/i18n` catalogs under `communication.<template>.<variant>` —
 * this module only renders `{param}` placeholders into it.
 */
import { DEFAULT_LOCALE, isLocale, type Locale } from "@mesomed/contracts/i18n";
import type { NotificationTemplate } from "@mesomed/contracts/communication";
import { locales } from "@mesomed/i18n";

export const TEMPLATE_VARIANTS = [
  "sms",
  "pushTitle",
  "pushBody",
  "emailSubject",
  "emailBody",
] as const;

export type TemplateVariant = (typeof TEMPLATE_VARIANTS)[number];

/** Coerces an arbitrary stored locale string to a platform locale — unknown/missing falls back to ckb. */
export function resolveLocale(value: string | null | undefined): Locale {
  if (value !== null && value !== undefined && isLocale(value)) return value;
  return DEFAULT_LOCALE;
}

/**
 * Substitutes `{param}` placeholders in `text` from `params`. A param with
 * no matching key is left visible in the output — a rendering bug should
 * be loud, not silently blank a sentence (rev01 semantics).
 */
function interpolate(text: string, params: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(params, key) ? params[key]! : match,
  );
}

export function renderTemplate(
  template: NotificationTemplate,
  variant: TemplateVariant,
  locale: Locale,
  params: Record<string, string>,
): string {
  const catalog = locales[locale].communication[template];
  return interpolate(catalog[variant], params);
}

/**
 * Appointment instant for message bodies, in Iraq wall-clock time. Not
 * locale-aware (a fixed `en-GB`-shaped format regardless of `locale`) —
 * full per-locale date formatting is an open item, not required for the
 * Phase 7 gate.
 */
export function formatAppointmentDateTime(startsAtIso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Baghdad",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(startsAtIso));
}

export interface TrilingualName {
  nameEn: string;
  nameAr: string;
  nameCkb: string;
}

/** Picks a trilingual display name (doctor/location) for the given locale. */
export function pickLocalizedName(name: TrilingualName, locale: Locale): string {
  if (locale === "ar") return name.nameAr;
  if (locale === "en") return name.nameEn;
  return name.nameCkb;
}
