import type { Metadata } from "next";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { Noto_Sans, Noto_Sans_Arabic } from "next/font/google";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { textDirection, type Locale } from "@mesomed/i18n";
import { SiteFooter } from "../../components/site-footer";
import { SiteHeader } from "../../components/site-header";
import { routing } from "../../i18n/routing";
import { Providers } from "../providers";
import "../globals.css";

/**
 * Custom fonts via next/font (self-hosted at build, zero layout shift —
 * MM-PLAN-001 §5 Phase 8, "current app has none"). Noto Sans Arabic covers
 * the full Arabic block including Kurdish Sorani letters (ڵ ڕ ێ ۆ ە);
 * Noto Sans carries Latin. The sans stack falls through latin → arabic.
 */
const latin = Noto_Sans({ subsets: ["latin"], variable: "--font-latin", display: "swap" });
const arabicScript = Noto_Sans_Arabic({
  subsets: ["arabic"],
  variable: "--font-arabic",
  display: "swap",
});

export const metadata: Metadata = {
  title: "MesoMed",
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  return (
    <html
      lang={locale}
      dir={textDirection(locale as Locale)}
      className={`${latin.variable} ${arabicScript.variable}`}
    >
      <body className="bg-canvas font-sans text-ink antialiased">
        <NextIntlClientProvider>
          <Providers locale={locale as Locale}>
            <div className="flex min-h-screen flex-col">
              <SiteHeader />
              <div className="flex-1">{children}</div>
              <SiteFooter />
            </div>
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
