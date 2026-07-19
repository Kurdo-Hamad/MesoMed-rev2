// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { locales } from "@mesomed/i18n";
import { Providers } from "../app/providers";
import { CountrySwitcher } from "../components/country-switcher";
import { COUNTRY_COOKIE } from "../lib/country";

// ADR-0055: the country switcher and the client transport are one
// mechanism — the switcher writes the cookie the layout reads back, and
// every client query must carry that country to the API. Only active
// countries may be offered: a coming_soon country's reads are rejected.

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("../i18n/navigation", () => ({ useRouter: () => ({ refresh }) }));

const T = locales.en.web.countrySwitcher;

const COUNTRIES = {
  countries: [
    {
      id: "1",
      slug: "iraq",
      isoCode: "IQ",
      name: { en: "Iraq", ar: "العراق", ckb: "عێراق" },
      sortOrder: 1,
      status: "active",
    },
    {
      id: "2",
      slug: "turkey",
      isoCode: "TR",
      name: { en: "Türkiye", ar: "تركيا", ckb: "تورکیا" },
      sortOrder: 2,
      status: "active",
    },
    {
      id: "3",
      slug: "uae",
      isoCode: "AE",
      name: { en: "UAE", ar: "الإمارات", ckb: "ئیمارات" },
      sortOrder: 3,
      status: "coming_soon",
    },
  ],
};

describe("country switcher", () => {
  let calls: Array<Headers>;

  beforeEach(() => {
    calls = [];
    refresh.mockClear();
    document.cookie = `${COUNTRY_COOKIE}=; path=/; max-age=0`;
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
      calls.push(new Headers(init.headers));
      return Promise.resolve(
        new Response(JSON.stringify([{ result: { data: COUNTRIES } }]), {
          headers: { "content-type": "application/json" },
        }),
      );
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function renderSwitcher(active: string) {
    return render(
      <Providers locale="en" country={active}>
        <NextIntlClientProvider locale="en" messages={locales.en}>
          <CountrySwitcher active={active} />
        </NextIntlClientProvider>
      </Providers>,
    );
  }

  it("offers active countries only and never a coming_soon one", async () => {
    renderSwitcher("IQ");
    const select = await screen.findByRole("combobox", { name: T.label });

    expect([...select.querySelectorAll("option")].map((option) => option.textContent)).toEqual([
      "Iraq",
      "Türkiye",
    ]);
  });

  it("writes the chosen country to the cookie and refreshes the route", async () => {
    renderSwitcher("IQ");
    const select = await screen.findByRole("combobox", { name: T.label });

    fireEvent.change(select, { target: { value: "TR" } });

    expect(document.cookie).toContain(`${COUNTRY_COOKIE}=TR`);
    expect(refresh).toHaveBeenCalled();
  });

  it("sends the active country on every client query", async () => {
    renderSwitcher("TR");
    await screen.findByRole("combobox", { name: T.label });

    expect(calls[0]?.get("x-mesomed-country")).toBe("TR");
    expect(calls[0]?.get("x-mesomed-locale")).toBe("en");
  });
});
