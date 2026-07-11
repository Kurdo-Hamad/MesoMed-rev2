import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  BILLING_TRIAL_CONFIG_KEY,
  DEFAULT_KNOWN_GATEWAY_IDS,
  KNOWN_GATEWAYS_CONFIG_KEY,
  PATIENT_COLLECTION_CONFIG_KEY,
  knownGatewaysSchema,
  resolveKnownGatewayIds,
  resolvePatientCollectionEnabled,
  resolveTrialDefaultMonths,
  type ConfigReader,
} from "../src/index.js";

function readerWith(expectedKey: string, value: unknown): ConfigReader {
  return {
    get: <Schema extends z.ZodType>(schema: Schema, key: string) => {
      expect(key).toBe(expectedKey);
      return Promise.resolve(schema.parse(value) as z.output<Schema>);
    },
  };
}

const notFound: ConfigReader = {
  get: () => Promise.reject(Object.assign(new Error("missing"), { code: "NOT_FOUND" })),
};

const broken: ConfigReader = {
  get: () => Promise.reject(new Error("connection refused")),
};

describe("resolveKnownGatewayIds", () => {
  it("includes stripe among the interface-ready launch defaults", () => {
    expect(DEFAULT_KNOWN_GATEWAY_IDS).toContain("stripe");
    expect(DEFAULT_KNOWN_GATEWAY_IDS).toContain("manual");
    expect(DEFAULT_KNOWN_GATEWAY_IDS).toContain("fib");
    expect(DEFAULT_KNOWN_GATEWAY_IDS).toContain("zaincash");
  });

  it("merges config-registered ids with the defaults, deduplicated", async () => {
    const reader = readerWith(KNOWN_GATEWAYS_CONFIG_KEY, ["fakepay", "manual"]);
    const ids = await resolveKnownGatewayIds(reader);
    expect(ids).toContain("fakepay");
    expect(ids.filter((id) => id === "manual")).toHaveLength(1);
  });

  it("falls back to the defaults when the row is missing; propagates outages", async () => {
    await expect(resolveKnownGatewayIds(notFound)).resolves.toEqual(DEFAULT_KNOWN_GATEWAY_IDS);
    await expect(resolveKnownGatewayIds(broken)).rejects.toThrow("connection refused");
  });

  it("rejects malformed gateway ids at the schema", () => {
    expect(() => knownGatewaysSchema.parse(["Fake-Pay"])).toThrow();
    expect(() => knownGatewaysSchema.parse([""])).toThrow();
  });
});

describe("resolveTrialDefaultMonths", () => {
  it("reads the configured default", async () => {
    const reader = readerWith(BILLING_TRIAL_CONFIG_KEY, { defaultMonths: 6 });
    await expect(resolveTrialDefaultMonths(reader)).resolves.toBe(6);
  });

  it("missing row → 0 (no global trial); outages propagate", async () => {
    await expect(resolveTrialDefaultMonths(notFound)).resolves.toBe(0);
    await expect(resolveTrialDefaultMonths(broken)).rejects.toThrow("connection refused");
  });
});

describe("resolvePatientCollectionEnabled", () => {
  it("reads the configured flag", async () => {
    const on = readerWith(PATIENT_COLLECTION_CONFIG_KEY, { enabled: true });
    await expect(resolvePatientCollectionEnabled(on)).resolves.toBe(true);
    const off = readerWith(PATIENT_COLLECTION_CONFIG_KEY, { enabled: false });
    await expect(resolvePatientCollectionEnabled(off)).resolves.toBe(false);
  });

  it("fails closed (false — the dormant launch state) on a missing row", async () => {
    await expect(resolvePatientCollectionEnabled(notFound)).resolves.toBe(false);
  });

  it("propagates outages instead of silently disabling collection", async () => {
    await expect(resolvePatientCollectionEnabled(broken)).rejects.toThrow("connection refused");
  });
});
