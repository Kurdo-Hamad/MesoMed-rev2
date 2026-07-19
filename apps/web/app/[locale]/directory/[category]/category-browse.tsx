"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@mesomed/i18n";
import { FilterSelect } from "../../../../components/filter-select";
import { CardSkeleton, FacilityCard } from "../../../../components/listing-cards";
import { citiesForCountry } from "../../../../lib/country";
import { pickText } from "../../../../lib/localized";
import { trpc } from "../../../../lib/trpc";

const PAGE_SIZE = 12;

/** Facility browse for one category: keyset pagination + city filter. */
export function CategoryBrowse({
  category,
  country,
  title,
}: {
  category: string;
  country: string;
  title: string;
}) {
  const t = useTranslations("web.directory");
  const locale = useLocale() as Locale;
  const [citySlug, setCitySlug] = useState<string | undefined>(undefined);

  const countries = trpc.directory.listCountries.useQuery();
  const cities = trpc.directory.listCities.useQuery();
  const facilities = trpc.directory.browseFacilities.useInfiniteQuery(
    { categorySlug: category, citySlug, limit: PAGE_SIZE },
    { getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined },
  );

  const cityOptions = citiesForCountry(
    cities.data?.cities ?? [],
    countries.data?.countries ?? [],
    country,
  );
  const items = facilities.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-title font-bold text-ink">{title}</h1>
        <FilterSelect
          label={t("city")}
          value={citySlug ?? ""}
          onChange={(value) => setCitySlug(value || undefined)}
        >
          <option value="">{t("allCities")}</option>
          {cityOptions.map((city) => (
            <option key={city.slug} value={city.slug}>
              {pickText(city.name, locale)}
            </option>
          ))}
        </FilterSelect>
      </div>

      {facilities.isLoading ? (
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: PAGE_SIZE }, (_, index) => (
            <CardSkeleton key={index} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="mt-6 rounded-lg border border-line bg-surface px-4 py-10 text-center text-body text-neutral-500">
          {t("empty")}
        </p>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((facility) => (
              <FacilityCard key={facility.slug} facility={facility} />
            ))}
          </div>
          {facilities.hasNextPage && (
            <div className="mt-8 flex justify-center">
              <button
                type="button"
                onClick={() => void facilities.fetchNextPage()}
                disabled={facilities.isFetchingNextPage}
                className="rounded-md border border-line bg-canvas px-6 py-2.5 text-small font-medium text-ink shadow-card transition-colors duration-fast hover:border-brand disabled:opacity-50"
              >
                {t("loadMore")}
              </button>
            </div>
          )}
        </>
      )}
    </main>
  );
}
