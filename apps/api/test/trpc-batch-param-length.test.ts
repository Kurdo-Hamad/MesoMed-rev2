import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import { buildServer } from "../src/app.js";
import { testEnv } from "./helpers.js";

/**
 * tRPC batched GETs join every procedure name into ONE Fastify path param
 * (`/trpc/a,b,c?batch=1`). Fastify's default maxParamLength (100 chars)
 * 414s any batch of ~6+ procedures with FST_ERR_MAX_PARAM_LENGTH before
 * tRPC ever sees the request — observed in the wild when the web clinic
 * page shifts the day 7 times in quick succession and the client batches
 * the 7 resulting clinicDay queries. This pins the server config
 * (app.ts maxParamLength) that keeps large-but-legitimate batches alive.
 */
describe("tRPC batched GET path length", () => {
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

  it("serves a 7-procedure batch whose joined path exceeds 100 chars", async () => {
    const procedures = Array.from({ length: 7 }, () => "directory.listCategories").join(",");
    expect(procedures.length).toBeGreaterThan(100); // the regression precondition

    const res = await app.inject({
      method: "GET",
      url: `/trpc/${procedures}?batch=1&input=${encodeURIComponent("{}")}`,
    });

    expect(res.statusCode).not.toBe(414);
    expect(res.statusCode).toBe(200);
    const results = res.json<Array<{ result?: { data?: unknown } }>>();
    expect(results).toHaveLength(7);
    for (const entry of results) {
      expect(entry.result?.data).toBeDefined();
    }
  });
});
