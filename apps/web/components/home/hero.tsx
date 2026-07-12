"use client";

import { useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Search } from "lucide-react";
import type { Locale } from "@mesomed/i18n";
import { useRouter } from "../../i18n/navigation";
import { pickText } from "../../lib/localized";
import { trpc } from "../../lib/trpc";

export function Hero({
  citySlug,
  onCityChange,
}: {
  citySlug: string | undefined;
  onCityChange: (slug: string | undefined) => void;
}) {
  const t = useTranslations("web.home.hero");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [query, setQuery] = useState("");
  const cities = trpc.directory.listCities.useQuery();

  function submit(event: FormEvent) {
    event.preventDefault();
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (citySlug) params.set("city", citySlug);
    router.push(`/search?${params.toString()}`);
  }

  return (
    <section className="bg-gradient-to-b from-brand-soft to-canvas">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-6 px-4 py-16 text-center sm:py-20">
        <h1 className="max-w-3xl text-balance text-title font-bold text-ink sm:text-display">
          {t("title")}
        </h1>
        <p className="max-w-2xl text-balance text-subtitle text-neutral-600">{t("subtitle")}</p>
        <form
          onSubmit={submit}
          className="flex w-full max-w-2xl flex-col gap-2 sm:flex-row"
          role="search"
        >
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute start-3 top-1/2 h-5 w-5 -translate-y-1/2 text-neutral-400"
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("searchPlaceholder")}
              className="h-12 w-full rounded-md border border-line bg-canvas ps-10 pe-4 text-body text-ink shadow-card outline-none transition-shadow duration-fast placeholder:text-neutral-400 focus:border-brand focus:shadow-raised"
            />
          </div>
          <select
            value={citySlug ?? ""}
            onChange={(event) => onCityChange(event.target.value || undefined)}
            aria-label={t("allCities")}
            className="h-12 rounded-md border border-line bg-canvas px-3 text-body text-ink shadow-card outline-none focus:border-brand"
          >
            <option value="">{t("allCities")}</option>
            {(cities.data?.cities ?? [])
              .filter((city) => city.active)
              .map((city) => (
                <option key={city.slug} value={city.slug}>
                  {pickText(city.name, locale)}
                </option>
              ))}
          </select>
          <button
            type="submit"
            className="h-12 rounded-md bg-brand px-6 text-body font-semibold text-white transition-colors duration-fast hover:bg-brand-strong"
          >
            {t("searchButton")}
          </button>
        </form>
      </div>
    </section>
  );
}
