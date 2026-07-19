"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import type { Locale } from "@mesomed/i18n";
import { COUNTRY_HEADER, LOCALE_HEADER } from "../lib/api-headers";
import { trpc } from "../lib/trpc";

// API listens on 4000; 3000 belongs to `next dev` (MM-QA-001 F-06).
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/**
 * Session cookies ride cross-origin to the API (`credentials: include` —
 * the API's CORS allowlist + SameSite cookie policy are the CSRF posture,
 * documented in docs/security-web.md). The active locale travels on every
 * call so localized reads (homepage feed ordering, error messages) match
 * the page. A locale switch remounts this provider — the [locale] segment
 * param changes — so the header is stable for a given client instance.
 * The browsing country travels the same way (ADR-0055); the layout keys
 * this provider by it, so a country switch remounts with a fresh header
 * and an empty query cache instead of serving the old country's rows.
 */
export function Providers({
  children,
  locale,
  country,
}: {
  children: ReactNode;
  locale: Locale;
  country: string;
}) {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: `${API_URL}/trpc`,
          headers: () => ({ [LOCALE_HEADER]: locale, [COUNTRY_HEADER]: country }),
          fetch: (url, options) => fetch(url, { ...options, credentials: "include" }),
        }),
      ],
    }),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
