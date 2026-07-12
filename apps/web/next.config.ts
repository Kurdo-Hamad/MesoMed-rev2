import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

/**
 * Facility/doctor media host for the Next image pipeline. remotePatterns is
 * an allowlist — the rev01 `unoptimized` regression (which bypassed the
 * pipeline entirely) must not return (MM-PLAN-001 §5 Phase 8).
 */
const media = new URL(process.env.NEXT_PUBLIC_MEDIA_URL ?? "http://localhost:4000");

/**
 * CSP is set per-request in middleware.ts (it carries a nonce); everything
 * static lives here. HSTS is inert over plain HTTP, so shipping it
 * unconditionally is safe locally and correct in production.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

const nextConfig: NextConfig = {
  transpilePackages: ["@mesomed/contracts", "@mesomed/i18n", "@mesomed/ui-tokens"],
  images: {
    remotePatterns: [
      {
        protocol: media.protocol.replace(":", "") as "http" | "https",
        hostname: media.hostname,
        ...(media.port ? { port: media.port } : {}),
      },
    ],
  },
  headers: async () => [{ source: "/(.*)", headers: securityHeaders }],
};

export default withNextIntl(nextConfig);
