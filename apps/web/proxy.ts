import createMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";
import { routing } from "./i18n/routing";

const handleI18nRouting = createMiddleware(routing);

const IS_DEV = process.env.NODE_ENV === "development";
const API_ORIGIN = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/**
 * Session-scoped areas are dynamically rendered, so their HTML can carry a
 * per-request nonce; everything else is SSG + CDN-cacheable (ADR-0012
 * layer 1), where a per-request nonce is impossible by construction.
 * Locale prefix is optional here — the request may arrive pre-redirect.
 */
const NONCE_PATHS = /^(\/(en|ar|ckb))?\/(dashboard|admin)(\/|$)/;

/**
 * CSP for the two rendering worlds (docs/security-web.md):
 * - nonce mode (dynamic pages): no inline scripts run without the nonce;
 *   `strict-dynamic` trusts only what nonced scripts load.
 * - static mode (SSG pages): React's flight data ships as inline scripts
 *   that static HTML cannot nonce, so `unsafe-inline` is allowed for
 *   scripts there; React's output escaping is the primary XSS control.
 *   Browsers ignore `unsafe-inline` whenever a nonce is present, which is
 *   why the modes are split per path instead of combined.
 */
function buildCsp(nonce: string | null): string {
  const script = nonce
    ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${IS_DEV ? " 'unsafe-eval'" : ""}`
    : `script-src 'self' 'unsafe-inline'${IS_DEV ? " 'unsafe-eval'" : ""}`;
  return [
    "default-src 'self'",
    script,
    // Next injects inline style attributes during hydration; styles are not
    // a script-execution surface, so the inline allowance stays.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${API_ORIGIN}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(IS_DEV ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export default function proxy(request: NextRequest) {
  const nonce = NONCE_PATHS.test(request.nextUrl.pathname) ? btoa(crypto.randomUUID()) : null;
  const csp = buildCsp(nonce);

  const response = handleI18nRouting(request);
  if (nonce) {
    // The nonce must travel on the REQUEST headers of the locale rewrite so
    // Next stamps it onto the scripts of dynamically rendered pages. The
    // i18n middleware builds the rewrite response itself, so the request-
    // header override is applied to that response the way NextResponse.next
    // encodes it: x-middleware-override-headers + x-middleware-request-*.
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("content-security-policy", csp);
    const overridden = new Set(
      (response.headers.get("x-middleware-override-headers") ?? "")
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean),
    );
    for (const [name, value] of requestHeaders) {
      overridden.add(name);
      response.headers.set(`x-middleware-request-${name}`, value);
    }
    response.headers.set("x-middleware-override-headers", [...overridden].join(","));
  }
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  // Skip static assets and files with extensions; everything else gets
  // locale routing + CSP.
  matcher: "/((?!_next|_vercel|.*\\..*).*)",
};
