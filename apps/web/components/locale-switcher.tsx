"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "../i18n/navigation";
import { routing } from "../i18n/routing";

/** Switches locale in place — the current path is preserved across locales. */
export function LocaleSwitcher() {
  const t = useTranslations("web.localeSwitcher");
  const active = useLocale();
  const pathname = usePathname();

  return (
    <nav aria-label={t("label")} className="flex items-center gap-1 text-caption">
      {routing.locales.map((locale) => (
        <Link
          key={locale}
          href={pathname}
          locale={locale}
          aria-current={locale === active ? "true" : undefined}
          className={
            locale === active
              ? "rounded-sm bg-brand-soft px-2 py-1 font-semibold text-brand"
              : "rounded-sm px-2 py-1 text-neutral-500 transition-colors duration-fast hover:text-ink"
          }
        >
          {t(locale)}
        </Link>
      ))}
    </nav>
  );
}
