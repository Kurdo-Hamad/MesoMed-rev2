/**
 * Directory hero-slide domain types.
 *
 * Shared by the pure filtering logic (`slide-utils.ts`) and its consumers.
 * Reconstructed from the ported salvage usage; the DB-backed implementation
 * maps its rows onto this shape.
 */

/** Localized alt text for a hero slide image (ICU catalog locales). */
export interface LocalizedAlt {
  en: string;
  ar: string;
  ckb: string;
}

/** A directory hero slide as consumed by the pure eligibility logic. */
export interface HeroSlide {
  id: string;
  desktopImageUrl: string;
  imageAlt: LocalizedAlt;
  priority: number;
  displayOrder: number;
  active: boolean;
  created_at: Date;
  updated_at: Date;
  /** Schedule window start; null/absent = no lower bound. */
  startsAt?: Date | null;
  /** Schedule window end; null/absent = no upper bound. */
  endsAt?: Date | null;
  /** City targeting; null/absent = show in all cities. */
  targetCityKey?: string | null;
}
