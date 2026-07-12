import type { Locale } from "@mesomed/contracts/i18n";

const NUMERIC_PARTS_LOCALE = "en-US";

interface NumericDateOptions {
  timeZone?: string;
}

function partsOf(date: Date, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormatPart[] {
  return new Intl.DateTimeFormat(NUMERIC_PARTS_LOCALE, options).formatToParts(date);
}

function partValue(parts: Intl.DateTimeFormatPart[], type: string): string {
  return parts.find((part) => part.type === type)?.value ?? "";
}

/**
 * d/M/yyyy, ASCII digits, day/month/year pinned in that order — ar and ckb
 * have no reliable CLDR month-name or digit support (ADR-0016 dev #3), so
 * this bypasses locale-derived month names and numbering systems entirely.
 */
export function formatNumericDate(
  value: Date | string | number,
  options: NumericDateOptions = {},
): string {
  const date = value instanceof Date ? value : new Date(value);
  const parts = partsOf(date, {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    numberingSystem: "latn",
    timeZone: options.timeZone,
  });
  return `${partValue(parts, "day")}/${partValue(parts, "month")}/${partValue(parts, "year")}`;
}

function timeOnlyOptions(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormatOptions {
  const { timeStyle, hour, minute, timeZone } = options;
  return { timeStyle, hour, minute, timeZone };
}

function hasTimeComponent(options: Intl.DateTimeFormatOptions): boolean {
  return Boolean(options.timeStyle || options.hour || options.minute);
}

/**
 * Date (optionally + time) for display. en keeps the existing long-form
 * Intl output unchanged; ar/ckb render the date portion as numeric
 * d/M/yyyy (no month-name catalog, per ADR-0016) with the original time
 * formatting appended when the caller asked for one.
 */
export function formatLocalizedDate(
  value: Date | string | number,
  locale: Locale,
  options: Intl.DateTimeFormatOptions,
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (locale === "en") {
    return new Intl.DateTimeFormat(locale, options).format(date);
  }
  const datePart = formatNumericDate(date, { timeZone: options.timeZone });
  if (!hasTimeComponent(options)) return datePart;
  const timePart = new Intl.DateTimeFormat(locale, timeOnlyOptions(options)).format(date);
  return `${datePart}, ${timePart}`;
}

const LEFT_TO_RIGHT_ISOLATE = "⁦";
const POP_DIRECTIONAL_ISOLATE = "⁩";

/** Unicode bidi isolate so a numeric date embedded inside an RTL sentence doesn't reorder. */
export function pinLtr(text: string): string {
  return `${LEFT_TO_RIGHT_ISOLATE}${text}${POP_DIRECTIONAL_ISOLATE}`;
}
