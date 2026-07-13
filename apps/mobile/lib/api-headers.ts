/**
 * Header name the API's kernel context reads (apps/api kernel/context.ts).
 * Kept as a literal here, same as apps/web/lib/api-headers.ts — importing
 * server kernel code into the client bundle would cross the module
 * boundary (§3.1); the contract tests pin the API side.
 */
export const LOCALE_HEADER = "x-mesomed-locale";
