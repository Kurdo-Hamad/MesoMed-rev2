// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ADR-0055: a deferred-visible category ("coming_soon" in the gating
// config) is browsable but has nothing to list — its landing must stay out
// of search indexes, while every active category keeps the default robots
// policy.

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined }),
}));
// The locale-aware navigation wrappers reach for Next's app-router runtime,
// which exists only inside a Next request — metadata needs none of it.
vi.mock("../i18n/navigation", () => ({ Link: () => null }));

const CATEGORIES = {
  categories: [
    { id: "1", slug: "hospital", name: {}, iconKey: null, active: true, status: "active" },
    {
      id: "2",
      slug: "medical_marketplace",
      name: {},
      iconKey: null,
      active: true,
      status: "coming_soon",
    },
  ],
};

describe("category landing metadata", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        new Response(JSON.stringify({ result: { data: CATEGORIES } }), {
          headers: { "content-type": "application/json" },
        }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("marks a coming_soon category noindex and leaves active ones indexable", async () => {
    const { generateMetadata } = await import("../app/[locale]/directory/[category]/page");

    const deferred = await generateMetadata({
      params: Promise.resolve({ locale: "en" as const, category: "medical_marketplace" }),
    });
    expect(deferred.robots).toEqual({ index: false, follow: false });

    const active = await generateMetadata({
      params: Promise.resolve({ locale: "en" as const, category: "hospital" }),
    });
    expect(active.robots).toBeUndefined();
  });
});
