import type { Metadata } from "next";
import type { ReactNode } from "react";
import { defaultLocale, textDirection } from "@mesomed/i18n";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "MesoMed",
};

// Locale-driven, never hardcoded (MM-PLAN-001 §3.10): ckb is the platform
// default, so the document renders RTL out of the box. Full locale routing
// (next-intl) lands with the Phase 8 web build-out (ADR-0002).
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang={defaultLocale} dir={textDirection(defaultLocale)}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
