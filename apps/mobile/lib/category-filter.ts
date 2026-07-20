/**
 * MM-QA-005 F-02: mobile is IQ-pinned and has no coming-soon tile surface
 * (ADR-0055 §8), so a category gated `coming_soon` must not reach the
 * directory grid — it was rendering as an ordinary tile leading to a
 * dead-end empty browse. Fail-open on a missing `status`, matching
 * packages/config's category-gating posture (an unlisted category
 * defaults to "active").
 */
export interface GatedCategory {
  active: boolean;
  status?: string;
}

export function isBookableCategory(category: GatedCategory): boolean {
  return category.active && category.status !== "coming_soon";
}
