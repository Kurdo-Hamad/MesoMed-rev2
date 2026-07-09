import Fastify from "fastify";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import { healthResponseSchema } from "@mesomed/contracts/health";
import { loadEnv } from "./env.js";
import { initSentry } from "./kernel/sentry.js";
import { shutdownOtel, startOtel } from "./kernel/otel.js";
import { createContext } from "./trpc/context.js";
import { appRouter } from "./trpc/router.js";

const env = loadEnv();

startOtel(env);
initSentry(env);

const app = Fastify({
  logger: {
    level: env.LOG_LEVEL,
    transport: env.NODE_ENV === "development" ? { target: "pino-pretty" } : undefined,
  },
});

app.get("/health", async () =>
  healthResponseSchema.parse({
    status: "ok",
    service: "api",
    timestamp: new Date().toISOString(),
  }),
);

await app.register(fastifyTRPCPlugin, {
  prefix: "/trpc",
  trpcOptions: { router: appRouter, createContext },
});

async function shutdown(signal: string): Promise<void> {
  app.log.info(`Received ${signal}, shutting down`);
  await app.close();
  await shutdownOtel();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

const address = await app.listen({ port: env.PORT, host: "0.0.0.0" });
app.log.info(`MesoMed API listening on ${address}`);
