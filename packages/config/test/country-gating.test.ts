import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  COUNTRY_GATING_CONFIG_KEY,
  countryGatingSchema,
  resolveCountryGating,
  type ConfigReader,
} from "../src/index.js";

function readerWith(value: unknown): ConfigReader {
  return {
    get: <Schema extends z.ZodType>(schema: Schema, key: string) => {
      expect(key).toBe(COUNTRY_GATING_CONFIG_KEY);
      return Promise.resolve(schema.parse(value) as z.output<Schema>);
    },
  };
}

describe("countryGatingSchema", () => {
  it("accepts ISO-code → status maps and rejects malformed entries", () => {
    expect(countryGatingSchema.parse({ IQ: "active", IR: "coming_soon" })).toEqual({
      IQ: "active",
      IR: "coming_soon",
    });
    expect(() => countryGatingSchema.parse({ iq: "active" })).toThrow();
    expect(() => countryGatingSchema.parse({ IQ: "launched" })).toThrow();
  });
});

describe("resolveCountryGating", () => {
  it("resolves listed countries and fails closed for unlisted ones", async () => {
    const reader = readerWith({ IQ: "active" });
    await expect(resolveCountryGating(reader, "IQ")).resolves.toBe("active");
    await expect(resolveCountryGating(reader, "iq")).resolves.toBe("active");
    await expect(resolveCountryGating(reader, "DE")).resolves.toBe("coming_soon");
  });

  it("fails closed when the config entry does not exist", async () => {
    const notFound: ConfigReader = {
      get: () => Promise.reject(Object.assign(new Error("missing"), { code: "NOT_FOUND" })),
    };
    await expect(resolveCountryGating(notFound, "IQ")).resolves.toBe("coming_soon");
  });

  it("propagates non-NOT_FOUND failures instead of masking an outage", async () => {
    const broken: ConfigReader = {
      get: () => Promise.reject(new Error("connection refused")),
    };
    await expect(resolveCountryGating(broken, "IQ")).rejects.toThrow("connection refused");
  });
});
