"use client";

import { useState } from "react";
import { CategoryGrid } from "../../components/home/category-grid";
import { Hero } from "../../components/home/hero";
import { RecommendedFeed } from "../../components/home/recommended-feed";

/**
 * Homepage (MM-PLAN-001 §5 Phase 8): hero + category cards + recommended
 * feed. The shell is SSG/CDN-cacheable; data arrives through client tRPC
 * queries served by the API's read cache (ADR-0012). City selection is
 * shared between the hero and the feed.
 */
export default function HomePage() {
  const [citySlug, setCitySlug] = useState<string | undefined>(undefined);

  return (
    <main>
      <Hero citySlug={citySlug} onCityChange={setCitySlug} />
      <CategoryGrid />
      <RecommendedFeed citySlug={citySlug} />
    </main>
  );
}
