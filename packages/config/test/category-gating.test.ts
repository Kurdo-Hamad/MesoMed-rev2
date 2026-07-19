import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  CATEGORY_GATING_CONFIG_KEY,
  categoryGatingSchema,
  readCategoryGating,
  resolveCategoryGating,
  type ConfigReader,
} from "../src/index.js";

function readerWith(value: unknown): ConfigReader {
  return {
    get: <Schema extends z.ZodType>(schema: Schema, key: string) => {
      expect(key).toBe(CATEGORY_GATING_CONFIG_KEY);
      return Promise.resolve(schema.parse(value) as z.output<Schema>);
    },
  };
}

describe("categoryGatingSchema", () => {
  it("accepts slug → status maps and rejects malformed entries", () => {
    expect(
      categoryGatingSchema.parse({ medical_marketplace: "coming_soon", laboratory: "active" }),
    ).toEqual({ medical_marketplace: "coming_soon", laboratory: "active" });
    expect(() => categoryGatingSchema.parse({ "Medical-Marketplace": "coming_soon" })).toThrow();
    expect(() => categoryGatingSchema.parse({ laboratory: "launched" })).toThrow();
  });
});

describe("resolveCategoryGating", () => {
  it("resolves listed categories and fails OPEN for unlisted ones", async () => {
    // Deliberate divergence from country gating (which fails closed): an
    // unlisted category is `active` — the row exists only to mark the
    // explicitly deferred categories, never to require listing every built
    // one (ADR-0055).
    const reader = readerWith({ medical_marketplace: "coming_soon" });
    await expect(resolveCategoryGating(reader, "medical_marketplace")).resolves.toBe("coming_soon");
    await expect(resolveCategoryGating(reader, "laboratory")).resolves.toBe("active");
  });

  it("fails open to an empty map when the config entry does not exist", async () => {
    const notFound: ConfigReader = {
      get: () => Promise.reject(Object.assign(new Error("missing"), { code: "NOT_FOUND" })),
    };
    await expect(readCategoryGating(notFound)).resolves.toEqual({});
    await expect(resolveCategoryGating(notFound, "medical_marketplace")).resolves.toBe("active");
  });

  it("propagates non-NOT_FOUND failures instead of masking an outage", async () => {
    const broken: ConfigReader = {
      get: () => Promise.reject(new Error("connection refused")),
    };
    await expect(readCategoryGating(broken)).rejects.toThrow("connection refused");
    await expect(resolveCategoryGating(broken, "laboratory")).rejects.toThrow("connection refused");
  });
});
