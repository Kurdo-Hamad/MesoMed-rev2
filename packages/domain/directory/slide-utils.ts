/**
 * Hero slide filtering and scheduling utilities
 *
 * Pure functions for filtering and ordering hero slides based on:
 * - Active status
 * - Scheduling window (starts_at, ends_at)
 * - City targeting (target_city_key NULL or matching)
 * - Priority (DESC) and display_order (ASC) ordering
 *
 * Used by the marketplace service; designed to be reused by the DB-backed
 * implementation without modification.
 */

import type { HeroSlide } from "./types";

/**
 * Filter and order hero slides for display.
 *
 * Eligibility criteria:
 * 1. active === true
 * 2. now >= startsAt (if startsAt is set)
 * 3. now <= endsAt (if endsAt is set)
 * 4. targetCityKey is NULL OR targetCityKey === cityKey
 *
 * Ordering:
 * - primary: priority DESC (higher priority first)
 * - secondary: displayOrder ASC (lower display order first)
 *
 * @param slides - Array of slides to filter
 * @param now - Current timestamp (for schedule window checks)
 * @param cityKey - Current city key (for targeting checks); optional
 * @returns Filtered and sorted slides
 */
export function getEligibleHeroSlides(
  slides: HeroSlide[],
  now: Date,
  cityKey?: string,
): HeroSlide[] {
  return slides
    .filter((slide) => {
      // Must be active
      if (!slide.active) return false;

      // Must be within scheduling window (if bounds are set)
      if (slide.startsAt && now < slide.startsAt) return false;
      if (slide.endsAt && now > slide.endsAt) return false;

      // City targeting: NULL = show all, or must match
      if (slide.targetCityKey && slide.targetCityKey !== cityKey) return false;

      return true;
    })
    .sort((a, b) => {
      // Primary: priority DESC (higher number first)
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      // Secondary: displayOrder ASC (lower number first)
      return a.displayOrder - b.displayOrder;
    });
}
