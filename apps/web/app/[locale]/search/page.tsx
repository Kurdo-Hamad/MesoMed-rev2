"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, Search as SearchIcon, Stethoscope } from "lucide-react";
import type { Locale } from "@mesomed/i18n";
import { FilterSelect } from "../../../components/filter-select";
import { Link } from "../../../i18n/navigation";
import { pickText } from "../../../lib/localized";
import { trpc } from "../../../lib/trpc";

type EntityFilter = "all" | "facility" | "doctor";

export default function SearchPage() {
  const t = useTranslations("web.search");
  // The heading renders in the static shell — the useSearchParams boundary
  // must not delay the LCP heading.
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10">
      <h1 className="text-title font-bold text-ink">{t("title")}</h1>
      <Suspense
        fallback={
          <div aria-busy="true">
            <div className="mt-5 flex gap-2">
              <div className="h-9 w-28 animate-pulse rounded-md bg-neutral-100" />
              <div className="h-9 w-28 animate-pulse rounded-md bg-neutral-100" />
            </div>
            {/* Real input in the shell: the placeholder text is the page's
                largest paint — it must not wait for hydration (LCP). */}
            <input
              type="search"
              disabled
              placeholder={t("inputPlaceholder")}
              className="mt-5 h-12 w-full rounded-md border border-line bg-canvas px-4 text-body shadow-card placeholder:text-neutral-400"
            />
            <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div className="h-40 animate-pulse rounded-lg bg-neutral-100" />
              <div className="h-40 animate-pulse rounded-lg bg-neutral-100" />
              <div className="h-40 animate-pulse rounded-lg bg-neutral-100" />
            </div>
          </div>
        }
      >
        <SearchPageInner />
      </Suspense>
    </main>
  );
}

function SearchPageInner() {
  const t = useTranslations("web.search");
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<"text" | "symptoms">("text");

  const tabClass = (active: boolean) =>
    active
      ? "rounded-md bg-brand px-4 py-2 text-small font-semibold text-white"
      : "rounded-md border border-line bg-canvas px-4 py-2 text-small font-medium text-neutral-600 transition-colors duration-fast hover:border-brand hover:text-ink";

  return (
    <>
      <div className="mt-5 flex gap-2" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "text"}
          onClick={() => setMode("text")}
          className={tabClass(mode === "text")}
        >
          {t("tabText")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "symptoms"}
          onClick={() => setMode("symptoms")}
          className={tabClass(mode === "symptoms")}
        >
          {t("tabSymptoms")}
        </button>
      </div>

      {mode === "text" ? (
        <TextSearch
          initialQuery={searchParams.get("q") ?? ""}
          initialCity={searchParams.get("city") ?? undefined}
        />
      ) : (
        <SymptomSearch />
      )}
    </>
  );
}

function TextSearch({
  initialQuery,
  initialCity,
}: {
  initialQuery: string;
  initialCity: string | undefined;
}) {
  const t = useTranslations("web.search");
  const locale = useLocale() as Locale;
  const [input, setInput] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery);
  const [entityFilter, setEntityFilter] = useState<EntityFilter>("all");
  const [citySlug] = useState<string | undefined>(initialCity);

  const results = trpc.search.listings.useQuery(
    {
      query,
      entityType: entityFilter === "all" ? undefined : entityFilter,
      citySlug,
      limit: 20,
    },
    { enabled: query.trim().length > 0 },
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    setQuery(input.trim());
  }

  return (
    <div className="mt-6">
      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row" role="search">
        <div className="relative flex-1">
          <SearchIcon
            className="pointer-events-none absolute start-3 top-1/2 h-5 w-5 -translate-y-1/2 text-neutral-400"
            aria-hidden="true"
          />
          <input
            type="search"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={t("inputPlaceholder")}
            className="h-11 w-full rounded-md border border-line bg-canvas ps-10 pe-4 text-body text-ink shadow-card outline-none transition-shadow duration-fast placeholder:text-neutral-400 focus:border-brand"
          />
        </div>
        <FilterSelect
          label={t("filterAll")}
          value={entityFilter}
          onChange={(value) => setEntityFilter(value as EntityFilter)}
        >
          <option value="all">{t("filterAll")}</option>
          <option value="facility">{t("filterFacilities")}</option>
          <option value="doctor">{t("filterDoctors")}</option>
        </FilterSelect>
        <button
          type="submit"
          className="h-11 rounded-md bg-brand px-6 text-body font-semibold text-white transition-colors duration-fast hover:bg-brand-strong"
        >
          {t("submit")}
        </button>
      </form>

      {query &&
        (results.isLoading ? (
          <ul className="mt-6 flex flex-col gap-2">
            {Array.from({ length: 5 }, (_, index) => (
              <li key={index} className="h-16 animate-pulse rounded-md bg-neutral-100" />
            ))}
          </ul>
        ) : (results.data?.items.length ?? 0) === 0 ? (
          <p className="mt-6 rounded-lg border border-line bg-surface px-4 py-10 text-center text-body text-neutral-500">
            {t("noResults")}
          </p>
        ) : (
          <ul className="mt-6 flex flex-col gap-2">
            {results.data!.items.map((item) => (
              <li key={`${item.entityType}-${item.entityId}`}>
                <Link
                  href={
                    item.entityType === "facility"
                      ? `/facility/${item.slug}`
                      : `/doctor/${item.slug}`
                  }
                  className="flex items-center justify-between gap-3 rounded-md border border-line bg-canvas px-4 py-3 shadow-card transition-all duration-fast hover:border-brand hover:shadow-raised"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-body font-semibold text-ink">
                      {pickText(item.name, locale)}
                    </span>
                    <span className="block text-caption text-neutral-500">
                      {item.entityType === "facility" ? t("filterFacilities") : t("filterDoctors")}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}

function SymptomSearch() {
  const t = useTranslations("web.search");
  const locale = useLocale() as Locale;
  const [text, setText] = useState("");
  const triage = trpc.ai.triageSymptoms.useMutation();
  const specialties = trpc.directory.listSpecialties.useQuery();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (text.trim()) triage.mutate({ text: text.trim() });
  }

  const suggested = (triage.data?.specialties ?? [])
    .map((key) => specialties.data?.specialties.find((row) => row.key === key))
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  return (
    <div className="mt-6">
      <p className="mb-4 flex items-start gap-2 rounded-md bg-info-soft px-4 py-3 text-small text-neutral-700">
        <Stethoscope className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden="true" />
        {t("triage.disclaimer")}
      </p>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={t("symptomPlaceholder")}
          rows={4}
          maxLength={1000}
          className="w-full rounded-md border border-line bg-canvas px-4 py-3 text-body text-ink shadow-card outline-none transition-shadow duration-fast placeholder:text-neutral-400 focus:border-brand"
        />
        <button
          type="submit"
          disabled={triage.isPending || !text.trim()}
          className="self-start rounded-md bg-brand px-6 py-2.5 text-body font-semibold text-white transition-colors duration-fast hover:bg-brand-strong disabled:opacity-50"
        >
          {t("analyze")}
        </button>
      </form>

      {triage.error && (
        <p className="mt-4 rounded-md bg-warning-soft px-4 py-3 text-small text-neutral-700">
          {t("triage.rateLimited")}
        </p>
      )}

      {triage.data?.redFlag && (
        <p className="mt-4 flex items-start gap-2 rounded-md bg-danger-soft px-4 py-4 text-body font-medium text-danger">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          {t("triage.redFlag")}
        </p>
      )}

      {triage.data && !triage.data.redFlag && (
        <section className="mt-6">
          {suggested.length === 0 ? (
            <p className="rounded-lg border border-line bg-surface px-4 py-8 text-center text-body text-neutral-500">
              {t("triage.noMatch")}
            </p>
          ) : (
            <>
              <h2 className="mb-3 text-heading font-bold text-ink">{t("triage.suggestions")}</h2>
              <ul className="flex flex-wrap gap-2">
                {suggested.map((specialty) => (
                  <li key={specialty.key}>
                    <Link
                      href={`/directory/doctors?specialty=${specialty.key}`}
                      className="inline-flex items-center gap-2 rounded-md border border-brand bg-brand-soft px-4 py-2 text-small font-semibold text-brand transition-colors duration-fast hover:bg-brand hover:text-white"
                    >
                      {pickText(specialty.name, locale)}
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-caption text-neutral-500">
                <Link href="/directory/doctors" className="text-brand hover:underline">
                  {t("triage.viewDoctors")}
                </Link>
              </p>
            </>
          )}
        </section>
      )}
    </div>
  );
}
