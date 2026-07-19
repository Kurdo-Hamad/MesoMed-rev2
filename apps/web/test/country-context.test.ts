import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { citiesForCountry, DEFAULT_COUNTRY, normalizeCountry } from "../lib/country";

// ADR-0055: every directory read is country-scoped by the x-mesomed-country
// header the API's kernel context reads. The web app's single source for it
// is the `mesomed-country` cookie — this suite pins the normalization, the
// city-list mapping the switcher depends on, and the server transport that
// must carry the header on every public read.

const cookieValue = vi.hoisted(() => ({ current: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => ({ value: cookieValue.current }) }),
}));

describe("country cookie normalization", () => {
  it("uppercases an ISO2 value", () => {
    expect(normalizeCountry("tr")).toBe("TR");
    expect(normalizeCountry("IQ")).toBe("IQ");
  });

  it("falls back to the default country for anything else", () => {
    expect(normalizeCountry(undefined)).toBe(DEFAULT_COUNTRY);
    expect(normalizeCountry("")).toBe(DEFAULT_COUNTRY);
    expect(normalizeCountry("IRQ")).toBe(DEFAULT_COUNTRY);
    expect(normalizeCountry("1Q")).toBe(DEFAULT_COUNTRY);
  });
});

describe("city options follow the browsing country", () => {
  const countries = [
    { isoCode: "IQ", slug: "iraq" },
    { isoCode: "TR", slug: "turkey" },
  ];
  const cities = [
    { slug: "erbil", countrySlug: "iraq", active: true },
    { slug: "kirkuk", countrySlug: "iraq", active: false },
    { slug: "istanbul", countrySlug: "turkey", active: true },
  ];

  it("keeps only the active cities of the selected country", () => {
    expect(citiesForCountry(cities, countries, "IQ").map((city) => city.slug)).toEqual(["erbil"]);
    expect(citiesForCountry(cities, countries, "TR").map((city) => city.slug)).toEqual([
      "istanbul",
    ]);
  });

  it("yields nothing for a country the taxonomy does not know", () => {
    expect(citiesForCountry(cities, countries, "DE")).toEqual([]);
  });
});

describe("server reads carry the locale and country headers", () => {
  let calls: Array<{ url: string; headers: Headers }>;

  beforeEach(() => {
    calls = [];
    cookieValue.current = undefined;
    vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
      calls.push({ url, headers: new Headers(init.headers) });
      return Promise.resolve(
        new Response(JSON.stringify({ result: { data: { ok: true } } }), {
          headers: { "content-type": "application/json" },
        }),
      );
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the cookie's country, uppercased", async () => {
    const { publicServerQuery } = await import("../lib/server-api");
    cookieValue.current = "tr";
    await publicServerQuery("directory.listCategories", undefined, { locale: "ar" });
    expect(calls[0]?.headers.get("x-mesomed-locale")).toBe("ar");
    expect(calls[0]?.headers.get("x-mesomed-country")).toBe("TR");
  });

  it("sends the default country when no cookie is set", async () => {
    const { publicServerQuery } = await import("../lib/server-api");
    cookieValue.current = undefined;
    await publicServerQuery("directory.listCategories", undefined, { locale: "en" });
    expect(calls[0]?.headers.get("x-mesomed-country")).toBe(DEFAULT_COUNTRY);
  });
});
