/**
 * Header names the API's kernel context reads (apps/api kernel/context.ts).
 * Kept as literals here — importing server kernel code into the client
 * bundle would cross the module boundary (§3.1); the contract tests pin
 * the API side.
 */
export const LOCALE_HEADER = "x-mesomed-locale";
export const COUNTRY_HEADER = "x-mesomed-country";
