/**
 * Seed entrypoint: `pnpm seed` (requires DATABASE_URL + BETTER_AUTH_SECRET).
 * Boots the real composition root so seeded commands emit through the real
 * outbox and the dispatcher drains events into the search read model, then
 * shuts down. Idempotent — safe to re-run against the same database.
 */
import { domainEvents, inArray } from "@mesomed/db";
import { buildServer } from "../../src/app.js";
import { loadEnv } from "../../src/env.js";
import { seedDirectory } from "./seed-directory.js";

async function main(): Promise<void> {
  const env = loadEnv();
  if (env.NODE_ENV === "production") {
    throw new Error("Refusing to seed a production environment");
  }
  const app = await buildServer(env);
  const { db, config, outbox, dispatcher } = app.kernel;

  try {
    await seedDirectory({ db, config, outbox, log: (message) => console.log(message) });

    console.log("Draining outbox into read models...");
    const deadline = Date.now() + 60_000;
    for (;;) {
      await dispatcher.pump();
      const open = await db
        .select({ id: domainEvents.id })
        .from(domainEvents)
        .where(inArray(domainEvents.status, ["pending", "published"]))
        .limit(1);
      if (open.length === 0) break;
      if (Date.now() > deadline) {
        throw new Error("Outbox did not drain within 60s — check dispatcher logs");
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    console.log("Seed complete.");
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error("Seed failed:", error);
  process.exitCode = 1;
});
