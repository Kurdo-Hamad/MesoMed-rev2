"use client";

import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@mesomed/i18n";
import { Link } from "../../i18n/navigation";
import { pickText } from "../../lib/localized";
import { trpc } from "../../lib/trpc";
import { CategoryIcon } from "../category-icon";

export function CategoryGrid() {
  const t = useTranslations("web.home.categories");
  const locale = useLocale() as Locale;
  const categories = trpc.directory.listCategories.useQuery();

  const items = (categories.data?.categories ?? []).filter((category) => category.active);

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-10">
      <h2 className="mb-5 text-heading font-bold text-ink">{t("heading")}</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {categories.isLoading
          ? Array.from({ length: 8 }, (_, index) => (
              <div
                key={index}
                className="h-24 animate-pulse rounded-lg border border-line bg-neutral-100"
              />
            ))
          : items.map((category) => (
              <Link
                key={category.slug}
                href={`/directory/${category.slug}`}
                className="group flex h-24 flex-col items-center justify-center gap-2 rounded-lg border border-line bg-canvas shadow-card transition-all duration-base hover:border-brand hover:shadow-raised"
              >
                <CategoryIcon
                  iconKey={category.iconKey}
                  className="h-6 w-6 text-brand transition-transform duration-base group-hover:scale-110"
                />
                <span className="px-2 text-center text-small font-medium text-ink">
                  {pickText(category.name, locale)}
                </span>
              </Link>
            ))}
      </div>
    </section>
  );
}
