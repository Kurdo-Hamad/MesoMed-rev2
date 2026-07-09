import * as Sentry from "@sentry/node";
import { buildServer } from "./app.js";
import { loadEnv } from "./env.js";
import { shutdownOtel } from "./kernel/otel.js";

const env = loadEnv();
const app = await buildServer(env);

const SHUTDOWN_TIMEOUT_MS = 10_000;
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info(`Received ${signal}, shutting down`);

  // If graceful teardown hangs (stuck connection, wedged exporter), fail
  // loudly instead of stalling the orchestrator (MM-QA-001 F-12).
  const forceExit = setTimeout(() => {
    app.log.error("Graceful shutdown timed out; forcing exit");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  try {
    await app.close();
    await Sentry.close(2_000);
    await shutdownOtel();
    process.exit(0);
  } catch (error) {
    app.log.error(error, "Shutdown failed");
    process.exit(1);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

const address = await app.listen({ port: env.PORT, host: "0.0.0.0" });
app.log.info(`MesoMed API listening on ${address}`);
