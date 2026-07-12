"use client";

import { useLocale, useTranslations } from "next-intl";
import { UserRound } from "lucide-react";
import type { Locale } from "@mesomed/i18n";
import { CategoryIcon } from "../../../components/category-icon";
import { Link } from "../../../i18n/navigation";
import { pickText } from "../../../lib/localized";
import { trpc } from "../../../lib/trpc";

/** Directory landing: every active category (data-driven — §3.9, adding a
 *  category is a config row, never a code change) plus the doctors entry. */
export default function DirectoryPage() {
  const t = useTranslations("web.directory");
  const locale = useLocale() as Locale;
  const categories = trpc.directory.listCategories.useQuery();

  const items = (categories.data?.categories ?? []).filter((category) => category.active);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10">
      <h1 className="text-title font-bold text-ink">{t("title")}</h1>
      <p className="mt-1 max-w-2xl text-body text-neutral-600">{t("subtitle")}</p>
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link
          href="/directory/doctors"
          className="group flex items-center gap-4 rounded-lg border border-line bg-canvas p-5 shadow-card transition-all duration-base hover:border-brand hover:shadow-raised"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-md bg-brand-soft">
            <UserRound className="h-6 w-6 text-brand" aria-hidden="true" />
          </span>
          <span className="flex flex-col">
            <span className="text-subtitle font-semibold text-ink group-hover:text-brand">
              {t("doctors")}
            </span>
            <span className="text-small text-neutral-500">{t("doctorsSubtitle")}</span>
          </span>
        </Link>
        {categories.isLoading
          ? Array.from({ length: 5 }, (_, index) => (
              <div
                key={index}
                className="h-[5.5rem] animate-pulse rounded-lg border border-line bg-neutral-100"
              />
            ))
          : items.map((category) => (
              <Link
                key={category.slug}
                href={`/directory/${category.slug}`}
                className="group flex items-center gap-4 rounded-lg border border-line bg-canvas p-5 shadow-card transition-all duration-base hover:border-brand hover:shadow-raised"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-md bg-brand-soft">
                  <CategoryIcon iconKey={category.iconKey} className="h-6 w-6 text-brand" />
                </span>
                <span className="text-subtitle font-semibold text-ink group-hover:text-brand">
                  {pickText(category.name, locale)}
                </span>
              </Link>
            ))}
      </div>
    </main>
  );
}
