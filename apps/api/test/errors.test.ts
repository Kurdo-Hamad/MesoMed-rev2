import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import { createEventRegistry } from "@mesomed/contracts/events";
import { ErrorCode } from "@mesomed/contracts/errors";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";
import { createConfigService } from "../src/kernel/config.js";
import { anonymousSessionResolver, createContextFactory } from "../src/kernel/context.js";
import { AppError } from "../src/kernel/errors.js";
import { createOutboxEmitter } from "../src/kernel/outbox.js";
import { publicProcedure, router } from "../src/kernel/trpc.js";

/**
 * Contract test for the real tRPC error pipeline (MM-QA-001 F-07): the
 * subject under test is the production `t` instance (middleware +
 * formatter) and context factory exported from the kernel, mounted with
 * throw-only probe procedures — the app itself (correctly) has no
 * endpoint whose contract is "always throws". Before the fix, every
 * AppError answered HTTP 500 and `data.code` was clobbered by the app
 * code.
 */
const probeRouter = router({
  notFound: publicProcedure.query(() => {
    throw new AppError(ErrorCode.NOT_FOUND, "no such thing");
  }),
  forbidden: publicProcedure.query(() => {
    throw new AppError(ErrorCode.FORBIDDEN, "not yours");
  }),
  boom: publicProcedure.query(() => {
    throw new Error("unexpected");
  }),
});

describe("tRPC error contract", () => {
  let tdb: TestDatabase;
  let app: FastifyInstance;

  beforeAll(async () => {
    tdb = await createTestDatabase();
    const registry = createEventRegistry([]);
    app = Fastify();
    await app.register(fastifyTRPCPlugin, {
      prefix: "/trpc",
      trpcOptions: {
        router: probeRouter,
        createContext: createContextFactory({
          services: {
            db: tdb.db,
            config: createConfigService(tdb.db),
            outbox: createOutboxEmitter(registry),
          },
          sessionResolver: anonymousSessionResolver,
          defaultCountry: "IQ",
        }),
      },
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await tdb.close();
  });

  it("AppError(NOT_FOUND) answers HTTP 404 with both code namespaces intact", async () => {
    const res = await app.inject({ method: "GET", url: "/trpc/notFound" });
    expect(res.statusCode).toBe(404);
    const { error } = res.json();
    expect(error.data.code).toBe("NOT_FOUND"); // canonical tRPC code preserved
    expect(error.data.appCode).toBe(ErrorCode.NOT_FOUND); // app code alongside
  });

  it("AppError(FORBIDDEN) answers HTTP 403", async () => {
    const res = await app.inject({ method: "GET", url: "/trpc/forbidden" });
    expect(res.statusCode).toBe(403);
    const { error } = res.json();
    expect(error.data.code).toBe("FORBIDDEN");
    expect(error.data.appCode).toBe(ErrorCode.FORBIDDEN);
  });

  it("an unexpected Error answers HTTP 500 with appCode INTERNAL", async () => {
    const res = await app.inject({ method: "GET", url: "/trpc/boom" });
    expect(res.statusCode).toBe(500);
    const { error } = res.json();
    expect(error.data.code).toBe("INTERNAL_SERVER_ERROR");
    expect(error.data.appCode).toBe(ErrorCode.INTERNAL);
  });
});
