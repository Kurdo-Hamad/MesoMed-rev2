import { cookies } from "next/headers";
import { COUNTRY_HEADER, LOCALE_HEADER } from "./api-headers";
import { COUNTRY_COOKIE, normalizeCountry } from "./country";

const API_URL =
  process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/** The country this request browses, read from the switcher's cookie. */
export async function activeCountry(): Promise<string> {
  return normalizeCountry((await cookies()).get(COUNTRY_COOKIE)?.value);
}

/**
 * Server-side read of a PUBLIC tRPC query (ADR-0012 layer 1): public,
 * non-personalized data may render on the server and ride the Next data
 * cache with a short revalidate window. Session-scoped reads must never
 * go through here — they stay on the client where the cookie lives.
 * Non-OK responses (incl. NOT_FOUND) return null and are not cached.
 *
 * Reading the country cookie makes every caller dynamic (ADR-0055) — the
 * directory reads it serves are country-scoped, so a shared static render
 * would serve the wrong country's listings.
 */
export async function publicServerQuery<T>(
  procedure: string,
  input: unknown,
  options: { locale: string; revalidate?: number },
): Promise<T | null> {
  const query = input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify(input))}`;
  try {
    const res = await fetch(`${API_URL}/trpc/${procedure}${query}`, {
      headers: { [LOCALE_HEADER]: options.locale, [COUNTRY_HEADER]: await activeCountry() },
      next: { revalidate: options.revalidate ?? 300 },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { result: { data: T } };
    return body.result.data;
  } catch {
    // Unreachable API (e.g. a build environment without the platform) is
    // an empty read, never a crashed render.
    return null;
  }
}
