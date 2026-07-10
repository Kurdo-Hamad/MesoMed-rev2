import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import {
  createEventRegistry,
  defineEvent,
  UnknownEventError,
  type EventName,
} from "../src/events/index.js";

const userRegistered = defineEvent(
  "identity",
  "user_registered",
  1,
  z.object({ userId: z.string() }),
);

describe("defineEvent", () => {
  it("brands the assembled name at the type level (MM-QA-001 F-20)", () => {
    expectTypeOf(userRegistered.name).toEqualTypeOf<"identity.user_registered.v1">();
    expectTypeOf(userRegistered.name).toExtend<EventName>();
    // @ts-expect-error a bare unversioned string is not an EventName
    const _bad: EventName = "user_registered";
  });

  it("parses a valid envelope", () => {
    const parsed = userRegistered.envelope.parse({
      name: "identity.user_registered.v1",
      version: 1,
      payload: { userId: "u1" },
    });
    expect(parsed.payload.userId).toBe("u1");
  });

  it("rejects a wrong event name", () => {
    expect(() =>
      userRegistered.envelope.parse({
        name: "identity.other.v1",
        version: 1,
        payload: { userId: "u1" },
      }),
    ).toThrow();
  });

  it("rejects a wrong version (breaking change = new version, MM-PLAN-001 §3.3)", () => {
    expect(() =>
      userRegistered.envelope.parse({
        name: "identity.user_registered.v1",
        version: 2,
        payload: { userId: "u1" },
      }),
    ).toThrow();
  });

  it("rejects an invalid payload", () => {
    expect(() =>
      userRegistered.envelope.parse({
        name: "identity.user_registered.v1",
        version: 1,
        payload: {},
      }),
    ).toThrow();
  });

  it("rejects malformed name segments and non-positive versions at definition time", () => {
    expect(() => defineEvent("Identity", "user_registered", 1, z.object({}))).toThrow(
      /segments must match/,
    );
    expect(() => defineEvent("identity", "user registered", 1, z.object({}))).toThrow(
      /segments must match/,
    );
    expect(() => defineEvent("identity", "user_registered", 0, z.object({}))).toThrow(
      /positive integer/,
    );
  });
});

describe("createEventRegistry", () => {
  const registry = createEventRegistry([userRegistered]);

  it("lists and looks up registered contracts", () => {
    expect(registry.names()).toEqual(["identity.user_registered.v1"]);
    expect(registry.get("identity.user_registered.v1")?.version).toBe(1);
    expect(registry.get("identity.unknown.v1")).toBeUndefined();
  });

  it("parses an envelope against the matching contract", () => {
    const envelope = registry.parse({
      name: "identity.user_registered.v1",
      version: 1,
      payload: { userId: "u1" },
    });
    expect(envelope.name).toBe("identity.user_registered.v1");
    expect(envelope.payload).toEqual({ userId: "u1" });
  });

  it("throws UnknownEventError for an unregistered name", () => {
    expect(() => registry.parse({ name: "identity.unknown.v1", version: 1, payload: {} })).toThrow(
      UnknownEventError,
    );
  });

  it("rejects an envelope whose payload violates the contract", () => {
    expect(() =>
      registry.parse({ name: "identity.user_registered.v1", version: 1, payload: {} }),
    ).toThrow();
  });

  it("rejects duplicate contract registration", () => {
    expect(() => createEventRegistry([userRegistered, userRegistered])).toThrow(/Duplicate/);
  });
});
