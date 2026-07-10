import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { ErrorCode } from "@mesomed/contracts/errors";
import { configEntries, eq } from "@mesomed/db";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import { buildServer } from "../src/app.js";
import { AppError } from "../src/kernel/errors.js";
import { testEnv } from "./helpers.js";

const countrySchema = z.object({
  code: z.string().length(2),
  enabled: z.boolean(),
});

/**
 * Config service gate (MM-PLAN-001 §5 Phase 1): a Zod-validated config row
 * round-trips through the loader, reads are cached, and invalidation is
 * proven to fire — a stale cache after a direct DB write is only cleared
 * by invalidate(), so both cache and invalidation are observable.
 */
describe("kernel config service", () => {
  let tdb: TestDatabase;
  let app: FastifyInstance;

  beforeAll(async () => {
    tdb = await createTestDatabase();
    app = await buildServer(testEnv(tdb.connectionString));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await tdb.close();
  });

  it("round-trips a Zod-validated config value", async () => {
    const { config } = app.kernel;
    await config.set(countrySchema, "country:IQ", { code: "IQ", enabled: true });
    const value = await config.get(countrySchema, "country:IQ");
    expect(value).toEqual({ code: "IQ", enabled: true });
  });

  it("throws AppError(NOT_FOUND) for a missing key", async () => {
    const { config } = app.kernel;
    const attempt = config.get(countrySchema, "country:XX");
    await expect(attempt).rejects.toBeInstanceOf(AppError);
    await expect(attempt).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it("rejects a value that violates the schema before writing", async () => {
    const { config, db } = app.kernel;
    await expect(
      config.set(countrySchema, "country:bad", { code: "TOOLONG", enabled: true }),
    ).rejects.toThrow();
    const rows = await db.select().from(configEntries);
    expect(rows.find((row) => row.key === "country:bad")).toBeUndefined();
  });

  it("serves reads from cache and refreshes on invalidate()", async () => {
    const { config, db } = app.kernel;
    await config.set(countrySchema, "country:JO", { code: "JO", enabled: false });
    expect((await config.get(countrySchema, "country:JO")).enabled).toBe(false);

    // Mutate behind the service's back: the cached value must still be
    // served (proving the cache exists) …
    await db
      .update(configEntries)
      .set({ value: { code: "JO", enabled: true } })
      .where(eq(configEntries.key, "country:JO"));
    expect((await config.get(countrySchema, "country:JO")).enabled).toBe(false);

    // … until invalidation drops it (proving invalidation fires).
    config.invalidate("country:JO");
    expect((await config.get(countrySchema, "country:JO")).enabled).toBe(true);
  });

  it("write-through set() invalidates its own key", async () => {
    const { config } = app.kernel;
    await config.set(countrySchema, "country:SA", { code: "SA", enabled: false });
    expect((await config.get(countrySchema, "country:SA")).enabled).toBe(false);
    await config.set(countrySchema, "country:SA", { code: "SA", enabled: true });
    expect((await config.get(countrySchema, "country:SA")).enabled).toBe(true);
  });
});
