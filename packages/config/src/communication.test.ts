import { describe, expect, it } from "vitest";
import {
  DEFAULT_AI_TRIAGE_RATE_POLICY,
  DEFAULT_SEND_RATE_POLICY,
  DEFAULT_VELOCITY_POLICY,
  channelBudgetsSchema,
  channelKillSwitchSchema,
  destinationCountriesSchema,
  resolveAiTriageRatePolicy,
  resolveChannelBudget,
  resolveChannelKilled,
  resolveDestinationCountry,
  resolveSendRatePolicy,
  resolveVelocityPolicy,
  type ConfigReader,
} from "./index.js";

/** A ConfigReader over a fixed key→value map; missing keys throw NOT_FOUND. */
function readerOf(entries: Record<string, unknown>): ConfigReader {
  return {
    async get(schema, key) {
      if (!(key in entries)) {
        throw Object.assign(new Error(`no config for ${key}`), { code: "NOT_FOUND" });
      }
      return schema.parse(entries[key]);
    },
  };
}

const EMPTY = readerOf({});

describe("channel kill-switch", () => {
  it("missing row means every channel is enabled", async () => {
    expect(await resolveChannelKilled(EMPTY, "whatsapp")).toBe(false);
  });

  it("a killed channel resolves true; unlisted channels stay enabled", async () => {
    const config = readerOf({ "communication.channel_kill_switch": { sms: true } });
    expect(await resolveChannelKilled(config, "sms")).toBe(true);
    expect(await resolveChannelKilled(config, "push")).toBe(false);
  });

  it("rejects unknown channel keys", () => {
    expect(() => channelKillSwitchSchema.parse({ fax: true })).toThrow();
  });
});

describe("destination-country allowlist", () => {
  it("falls back to the Iraq-only launch seed when no row exists", async () => {
    expect(await resolveDestinationCountry(EMPTY, "+9647701234567")).toBe("IQ");
    expect(await resolveDestinationCountry(EMPTY, "+14155550100")).toBeNull();
  });

  it("matches configured prefixes and denies everything else (fail closed)", async () => {
    const config = readerOf({
      "communication.destination_countries": { IQ: { prefixes: ["+964"] } },
    });
    expect(await resolveDestinationCountry(config, "+9647811111111")).toBe("IQ");
    expect(await resolveDestinationCountry(config, "+971501111111")).toBeNull();
  });

  it("rejects malformed prefixes", () => {
    expect(() => destinationCountriesSchema.parse({ IQ: { prefixes: ["964"] } })).toThrow();
  });
});

describe("channel budgets", () => {
  it("null when unbudgeted", async () => {
    expect(await resolveChannelBudget(EMPTY, "whatsapp")).toBeNull();
  });

  it("returns the configured budget for the channel", async () => {
    const config = readerOf({
      "communication.channel_budgets": { whatsapp: { dailyLimit: 100, alarmAt: 80 } },
    });
    expect(await resolveChannelBudget(config, "whatsapp")).toEqual({
      dailyLimit: 100,
      alarmAt: 80,
    });
    expect(await resolveChannelBudget(config, "sms")).toBeNull();
  });

  it("rejects negative limits", () => {
    expect(() => channelBudgetsSchema.parse({ sms: { dailyLimit: -1, alarmAt: 0 } })).toThrow();
  });
});

describe("send-rate policy", () => {
  it("defaults are on when no row exists — guardrails never off by omission", async () => {
    expect(await resolveSendRatePolicy(EMPTY, "phone")).toEqual(DEFAULT_SEND_RATE_POLICY.phone);
    expect(await resolveSendRatePolicy(EMPTY, "ip")).toEqual(DEFAULT_SEND_RATE_POLICY.ip);
  });

  it("a configured scope overrides its default; others keep theirs", async () => {
    const config = readerOf({
      "communication.send_rate_policy": { phone: { maxSends: 2, windowSeconds: 60 } },
    });
    expect(await resolveSendRatePolicy(config, "phone")).toEqual({
      maxSends: 2,
      windowSeconds: 60,
    });
    expect(await resolveSendRatePolicy(config, "device")).toEqual(
      DEFAULT_SEND_RATE_POLICY.device,
    );
  });
});

describe("velocity policy", () => {
  it("defaults when no row exists", async () => {
    expect(await resolveVelocityPolicy(EMPTY)).toEqual(DEFAULT_VELOCITY_POLICY);
  });
});

describe("ai triage rate policy", () => {
  it("defaults when no row exists", async () => {
    expect(await resolveAiTriageRatePolicy(EMPTY)).toEqual(DEFAULT_AI_TRIAGE_RATE_POLICY);
  });

  it("reads a configured policy", async () => {
    const policy = {
      perCaller: { capacity: 3, refillPerSecond: 0.5 },
      global: { capacity: 10, refillPerSecond: 1 },
    };
    const config = readerOf({ "ai.triage_rate_policy": policy });
    expect(await resolveAiTriageRatePolicy(config)).toEqual(policy);
  });
});
