/**
 * Self-contained dev/e2e harness: embedded Postgres + migrations + seed +
 * the real composition root listening on PORT (default 4000). No Docker,
 * no external DATABASE_URL — the same embedded-PG16 helper the test suite
 * uses. Ctrl-C tears everything down. Used by local verification and the
 * Playwright e2e suite (Phase 8).
 */
import { domainEvents, inArray } from "@mesomed/db";
import { createTestDatabase } from "@mesomed/db/testing";
import { buildServer } from "../src/app.js";
import { loadEnv } from "../src/env.js";
import { seedDirectory } from "./seed/seed-directory.js";

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 4000);
  const tdb = await createTestDatabase();
  console.log(`Embedded Postgres up: ${tdb.connectionString}`);

  process.env.DATABASE_URL = tdb.connectionString;
  process.env.NODE_ENV ??= "development";
  process.env.BETTER_AUTH_SECRET ??= "dev-embedded-secret-dev-embedded-secret";
  process.env.LOG_LEVEL ??= "warn";
  // Production poll defaults drain the ~150-event seed too slowly for an
  // interactive harness — use the test env's fast dispatcher cadence.
  process.env.OUTBOX_POLL_INTERVAL_MS ??= "200";
  process.env.OUTBOX_WORKER_POLL_INTERVAL_S ??= "0.5";
  const env = loadEnv();
  if (env.NODE_ENV === "production") {
    throw new Error("Refusing to run the embedded dev harness in production");
  }

  const app = await buildServer(env);
  const { db, config, outbox, dispatcher } = app.kernel;

  await seedDirectory({ db, config, outbox, log: (message) => console.log(message) });
  console.log("Draining outbox into read models...");
  // Convergence, not speed (seed.test.ts precedent): generous on slow machines.
  const deadline = Date.now() + 240_000;
  for (;;) {
    await dispatcher.pump();
    const open = await db
      .select({ id: domainEvents.id })
      .from(domainEvents)
      .where(inArray(domainEvents.status, ["pending", "published"]))
      .limit(1);
    if (open.length === 0) break;
    if (Date.now() > deadline) throw new Error("Outbox did not drain within 120s");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  await app.listen({ port, host: "0.0.0.0" });
  console.log(`API ready on http://localhost:${port} (seeded, embedded PG)`);

  const shutdown = async () => {
    console.log("Shutting down dev harness…");
    await app.close();
    await tdb.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("Dev harness failed:", error);
  process.exitCode = 1;
});
