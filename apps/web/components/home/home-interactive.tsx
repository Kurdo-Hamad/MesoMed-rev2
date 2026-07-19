"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Search } from "lucide-react";
import type { Locale } from "@mesomed/i18n";
import { useRouter } from "../../i18n/navigation";
import { citiesForCountry } from "../../lib/country";
import { pickText } from "../../lib/localized";
import { trpc } from "../../lib/trpc";
import { RecommendedFeed } from "./recommended-feed";

/**
 * The interactive slice of the homepage: search form + city selector and
 * the city-reactive recommended feed. Everything static around it (hero
 * heading, category grid) is server-rendered — the LCP heading must not
 * depend on hydration (§3.8 performance budget). `staticSections` carries
 * the server-rendered content that sits between the form and the feed.
 */
export function HomeInteractive({
  country,
  staticSections,
}: {
  country: string;
  staticSections: ReactNode;
}) {
  const [citySlug, setCitySlug] = useState<string | undefined>(undefined);

  return (
    <>
      <SearchForm country={country} citySlug={citySlug} onCityChange={setCitySlug} />
      {staticSections}
      <RecommendedFeed citySlug={citySlug} />
    </>
  );
}

function SearchForm({
  country,
  citySlug,
  onCityChange,
}: {
  country: string;
  citySlug: string | undefined;
  onCityChange: (slug: string | undefined) => void;
}) {
  const t = useTranslations("web.home.hero");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [query, setQuery] = useState("");
  const countries = trpc.directory.listCountries.useQuery();
  const cities = trpc.directory.listCities.useQuery();
  const cityOptions = citiesForCountry(
    cities.data?.cities ?? [],
    countries.data?.countries ?? [],
    country,
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (citySlug) params.set("city", citySlug);
    router.push(`/search?${params.toString()}`);
  }

  return (
    <div className="bg-gradient-to-b from-brand-soft to-canvas">
      <form
        onSubmit={submit}
        className="mx-auto flex w-full max-w-2xl flex-col gap-2 px-4 pb-16 sm:flex-row sm:pb-20"
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
          {cityOptions.map((city) => (
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
  );
}
