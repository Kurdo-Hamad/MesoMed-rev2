"use client";

import { Suspense, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@mesomed/i18n";
import { FilterSelect } from "../../../../components/filter-select";
import { CardSkeleton, DoctorCard } from "../../../../components/listing-cards";
import { pickText } from "../../../../lib/localized";
import { trpc } from "../../../../lib/trpc";
import { useSearchParams } from "next/navigation";

const PAGE_SIZE = 12;

export default function DoctorsBrowsePage() {
  const t = useTranslations("web.directory");
  // The heading and the reserved grid render in the static shell — the
  // useSearchParams boundary must not delay the LCP heading or let the
  // footer jump when the grid hydrates (CLS).
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10">
      <h1 className="text-title font-bold text-ink">{t("doctors")}</h1>
      <Suspense
        fallback={
          <div
            aria-busy="true"
            className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
          >
            {Array.from({ length: PAGE_SIZE }, (_, index) => (
              <CardSkeleton key={index} />
            ))}
          </div>
        }
      >
        <DoctorsBrowseInner />
      </Suspense>
    </main>
  );
}

/** Doctor browse: specialty + city filters, keyset pagination. `?specialty=`
 *  pre-selects (symptom triage links land here). */
function DoctorsBrowseInner() {
  const t = useTranslations("web.directory");
  const locale = useLocale() as Locale;
  const searchParams = useSearchParams();
  const [specialtyKey, setSpecialtyKey] = useState<string | undefined>(
    searchParams.get("specialty") ?? undefined,
  );
  const [citySlug, setCitySlug] = useState<string | undefined>(undefined);

  const specialties = trpc.directory.listSpecialties.useQuery();
  const cities = trpc.directory.listCities.useQuery();
  const doctors = trpc.directory.browseDoctors.useInfiniteQuery(
    { specialtyKey, citySlug, limit: PAGE_SIZE },
    { getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined },
  );

  const items = doctors.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <div className="-mt-9 flex flex-wrap items-end justify-end gap-4">
        <div className="flex flex-wrap gap-2">
          <FilterSelect
            label={t("specialty")}
            value={specialtyKey ?? ""}
            onChange={(value) => setSpecialtyKey(value || undefined)}
          >
            <option value="">{t("allSpecialties")}</option>
            {(specialties.data?.specialties ?? [])
              .filter((specialty) => specialty.active)
              .map((specialty) => (
                <option key={specialty.key} value={specialty.key}>
                  {pickText(specialty.name, locale)}
                </option>
              ))}
          </FilterSelect>
          <FilterSelect
            label={t("city")}
            value={citySlug ?? ""}
            onChange={(value) => setCitySlug(value || undefined)}
          >
            <option value="">{t("allCities")}</option>
            {(cities.data?.cities ?? [])
              .filter((city) => city.active)
              .map((city) => (
                <option key={city.slug} value={city.slug}>
                  {pickText(city.name, locale)}
                </option>
              ))}
          </FilterSelect>
        </div>
      </div>

      {doctors.isLoading ? (
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
            {items.map((doctor) => (
              <DoctorCard key={doctor.slug} doctor={doctor} />
            ))}
          </div>
          {doctors.hasNextPage && (
            <div className="mt-8 flex justify-center">
              <button
                type="button"
                onClick={() => void doctors.fetchNextPage()}
                disabled={doctors.isFetchingNextPage}
                className="rounded-md border border-line bg-canvas px-6 py-2.5 text-small font-medium text-ink shadow-card transition-colors duration-fast hover:border-brand disabled:opacity-50"
              >
                {t("loadMore")}
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
