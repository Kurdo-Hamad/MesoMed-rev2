"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import type { Locale } from "@mesomed/i18n";
import { LOCALE_HEADER } from "../lib/api-headers";
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
 */
export function Providers({ children, locale }: { children: ReactNode; locale: Locale }) {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: `${API_URL}/trpc`,
          headers: () => ({ [LOCALE_HEADER]: locale }),
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
