/**
 * Browsing country (ADR-0055). The choice lives in a readable cookie so the
 * server render and the client tRPC link send the same x-mesomed-country —
 * the header the API's kernel context gates and scopes every country-scoped
 * read by. Not httpOnly by design: the switcher writes it from the client.
 */
export const COUNTRY_COOKIE = "mesomed-country";
export const DEFAULT_COUNTRY = "IQ";

/** Anything that is not an ISO2 pair falls back to the default country. */
export function normalizeCountry(value: string | undefined): string {
  return value !== undefined && /^[A-Za-z]{2}$/.test(value) ? value.toUpperCase() : DEFAULT_COUNTRY;
}

/**
 * City options for one country: `listCities` is global, the taxonomy row
 * carries the country slug, and the switcher speaks ISO codes — so the
 * country list is the map between them. An unknown ISO yields no cities
 * rather than another country's.
 */
export function citiesForCountry<C extends { active: boolean; countrySlug: string }>(
  cities: readonly C[],
  countries: readonly { isoCode: string; slug: string }[],
  countryIso: string,
): C[] {
  const countrySlug = countries.find((country) => country.isoCode === countryIso)?.slug;
  return cities.filter((city) => city.active && city.countrySlug === countrySlug);
}
