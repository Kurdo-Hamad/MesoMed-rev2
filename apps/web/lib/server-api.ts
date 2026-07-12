import { LOCALE_HEADER } from "./api-headers";

const API_URL =
  process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/**
 * Server-side read of a PUBLIC tRPC query (ADR-0012 layer 1): public,
 * non-personalized data may render on the server and ride the Next data
 * cache with a short revalidate window. Session-scoped reads must never
 * go through here — they stay on the client where the cookie lives.
 * Non-OK responses (incl. NOT_FOUND) return null and are not cached.
 */
export async function publicServerQuery<T>(
  procedure: string,
  input: unknown,
  options: { locale: string; revalidate?: number },
): Promise<T | null> {
  const query = input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify(input))}`;
  try {
    const res = await fetch(`${API_URL}/trpc/${procedure}${query}`, {
      headers: { [LOCALE_HEADER]: options.locale },
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
