import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DIRECTORY_PROVIDER_TYPES } from "../src/index.js";
import { createTestDatabase, type TestDatabase } from "../src/testing/index.js";

/**
 * Regression lock for the provider-type vocabulary (ADR-0056): the TS
 * `DIRECTORY_PROVIDER_TYPES` array and the `providers_type_check` constraint
 * must accept exactly the same values. A value added to the array without a
 * migration extending the constraint fails here instead of failing a real
 * seed deep into execution with a raw Postgres error.
 */
describe("directory provider-type vocabulary", () => {
  let tdb: TestDatabase;

  beforeAll(async () => {
    tdb = await createTestDatabase();
  });

  afterAll(async () => {
    await tdb.close();
  });

  it("accepts every declared provider type at the database level", async () => {
    for (const providerType of DIRECTORY_PROVIDER_TYPES) {
      const { rows } = await tdb.pool.query<{ provider_type: string }>(
        `insert into providers (provider_type) values ($1) returning provider_type`,
        [providerType],
      );
      expect(rows[0]?.provider_type).toBe(providerType);
    }
  });

  it("rejects an out-of-vocabulary provider type at the database level", async () => {
    await expect(
      tdb.pool.query(`insert into providers (provider_type) values ('teleportation_clinic')`),
    ).rejects.toThrow(/providers_type_check/);
  });
});
