// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { CategoryIcon } from "../components/category-icon";

// ADR-0055 seeds eight new categories whose icon keys were absent from the
// curated allowlist, plus dental_clinic's "tooth" which had silently fallen
// back to the stethoscope since Phase 8. Each seeded key must resolve to a
// glyph of its own, never to the unknown-key fallback.
const SEEDED_ICON_KEYS = [
  "microscope",
  "pill",
  "house",
  "scissors",
  "scale",
  "activity",
  "shopping-bag",
  "video",
  "tooth",
];

function markup(iconKey: string | null): string {
  return render(<CategoryIcon iconKey={iconKey} />).container.innerHTML;
}

describe("category icon allowlist", () => {
  const fallback = markup("no-such-icon-key");

  it("renders the fallback for an unknown or absent key", () => {
    expect(markup(null)).toBe(fallback);
  });

  it("resolves every seeded icon key to a distinct glyph", () => {
    const rendered = SEEDED_ICON_KEYS.map((key) => [key, markup(key)] as const);
    expect(rendered.filter(([, html]) => html === fallback).map(([key]) => key)).toEqual([]);
    expect(new Set(rendered.map(([, html]) => html)).size).toBe(SEEDED_ICON_KEYS.length);
  });
});
