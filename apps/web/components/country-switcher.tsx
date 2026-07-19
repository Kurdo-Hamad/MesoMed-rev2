"use client";

import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@mesomed/i18n";
import { useRouter } from "../i18n/navigation";
import { COUNTRY_COOKIE } from "../lib/country";
import { pickText } from "../lib/localized";
import { trpc } from "../lib/trpc";
import { FilterSelect } from "./filter-select";

const COOKIE_MAX_AGE_S = 60 * 60 * 24 * 365;

/**
 * Switches the browsing country (ADR-0055): writes the cookie the server
 * render and the tRPC link both read, then refreshes so the whole tree
 * re-renders against the new country. Only active countries are offered —
 * a coming_soon country's reads are rejected by the API's country gate.
 */
export function CountrySwitcher({ active }: { active: string }) {
  const t = useTranslations("web.countrySwitcher");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const countries = trpc.directory.listCountries.useQuery();
  const options = (countries.data?.countries ?? []).filter(
    (country) => country.status === "active",
  );

  function select(isoCode: string) {
    document.cookie = `${COUNTRY_COOKIE}=${isoCode}; path=/; max-age=${COOKIE_MAX_AGE_S}; samesite=lax`;
    router.refresh();
  }

  // Until the taxonomy arrives there is nothing to switch between; an empty
  // select in the header would only flash a blank control.
  if (options.length === 0) return null;

  return (
    <FilterSelect label={t("label")} value={active} onChange={select}>
      {options.map((country) => (
        <option key={country.isoCode} value={country.isoCode}>
          {pickText(country.name, locale)}
        </option>
      ))}
    </FilterSelect>
  );
}
