import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  CATEGORY_DISPLAY_CONFIG_KEY,
  categoryDisplaySchema,
  DOCTORS_TILE_ID,
  resolveCategoryDisplay,
  type ConfigReader,
} from "../src/index.js";

function readerWith(value: unknown): ConfigReader {
  return {
    get: <Schema extends z.ZodType>(schema: Schema, key: string) => {
      expect(key).toBe(CATEGORY_DISPLAY_CONFIG_KEY);
      return Promise.resolve(schema.parse(value) as z.output<Schema>);
    },
  };
}

describe("categoryDisplaySchema", () => {
  it("accepts ISO-code → tile-list maps and rejects malformed entries", () => {
    expect(categoryDisplaySchema.parse({ IR: [DOCTORS_TILE_ID, "hospital"] })).toEqual({
      IR: ["doctors", "hospital"],
    });
    expect(() => categoryDisplaySchema.parse({ ir: ["hospital"] })).toThrow();
    expect(() => categoryDisplaySchema.parse({ IR: ["Dental-Clinic"] })).toThrow();
    expect(() => categoryDisplaySchema.parse({ IR: [] })).toThrow();
  });
});

describe("resolveCategoryDisplay", () => {
  it("resolves the configured tile list and null for unlisted countries", async () => {
    const reader = readerWith({ IR: ["doctors", "hospital"] });
    await expect(resolveCategoryDisplay(reader, "IR")).resolves.toEqual(["doctors", "hospital"]);
    await expect(resolveCategoryDisplay(reader, "ir")).resolves.toEqual(["doctors", "hospital"]);
    // Unlisted country → null: the caller falls back to the full active
    // category list (IQ is deliberately unlisted at launch, ADR-0055).
    await expect(resolveCategoryDisplay(reader, "IQ")).resolves.toBeNull();
  });

  it("resolves null when the config entry does not exist", async () => {
    const notFound: ConfigReader = {
      get: () => Promise.reject(Object.assign(new Error("missing"), { code: "NOT_FOUND" })),
    };
    await expect(resolveCategoryDisplay(notFound, "IR")).resolves.toBeNull();
  });

  it("propagates non-NOT_FOUND failures instead of masking an outage", async () => {
    const broken: ConfigReader = {
      get: () => Promise.reject(new Error("connection refused")),
    };
    await expect(resolveCategoryDisplay(broken, "IR")).rejects.toThrow("connection refused");
  });
});
