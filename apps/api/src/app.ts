import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import * as Sentry from "@sentry/node";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import { createEventRegistry, type EventRegistry } from "@mesomed/contracts/events";
import { IDENTITY_EVENTS } from "@mesomed/contracts/events/identity";
import { DIRECTORY_EVENTS } from "@mesomed/contracts/events/directory";
import { BOOKING_EVENTS } from "@mesomed/contracts/events/booking";
import { CLINICAL_EVENTS } from "@mesomed/contracts/events/clinical";
import { createDb, type Db } from "@mesomed/db";
import { createMockEmailChannel, createMockOtpChannel, type EmailChannel } from "@mesomed/platform";
import type pg from "pg";
import type { Env } from "./env.js";
import { createContextFactory, type SessionResolver } from "./kernel/context.js";
import { createConfigService, type ConfigService } from "./kernel/config.js";
import { createOutboxDispatcher, type OutboxDispatcher } from "./kernel/dispatcher.js";
import { createHandlerRegistry, type HandlerRegistry } from "./kernel/events.js";
import { healthPayload, readinessPayload } from "./kernel/health.js";
import { createOutboxEmitter, type OutboxEmitter } from "./kernel/outbox.js";
import { registerClinicalSubscribers } from "./modules/clinical/index.js";
import { registerDirectorySubscribers } from "./modules/directory/index.js";
import { createIdentityModule, type IdentityModule } from "./modules/identity/index.js";
import { registerAuthRoutes } from "./modules/identity/routes.js";
import { registerSearchSubscribers } from "./modules/search/index.js";
import type { IdentityOtpOptions } from "./modules/identity/auth.js";
import type { OtpChannels } from "./modules/identity/otp-sender.js";
import { createAppRouter } from "./trpc/router.js";

/** The kernel services the composition root wires, exposed for tests/ops. */
export interface KernelServices {
  db: Db;
  pool: pg.Pool;
  config: ConfigService;
  outbox: OutboxEmitter;
  events: HandlerRegistry;
  dispatcher: OutboxDispatcher;
  registry: EventRegistry;
}

declare module "fastify" {
  interface FastifyInstance {
    kernel: KernelServices;
    identity: IdentityModule;
  }
}

/**
 * Explicit composition seams. Phase 2 replaces the session resolver with
 * Better Auth; modules contribute their event contracts and subscribers
 * here as they land. Tests inject fixtures through the same seams instead
 * of hand-wiring a copy of the app (MM-QA-001 F-05).
 */
export interface BuildServerOverrides {
  sessionResolver?: SessionResolver;
  eventRegistry?: EventRegistry;
  eventHandlers?: HandlerRegistry;
  /** OTP transports (mock by default through Phase 2 — MM-DEC rev02 §8). */
  otpChannels?: OtpChannels;
  /** Email transport (mock by default through Phase 2; Resend in Phase 7). */
  emailChannel?: EmailChannel;
  /** OTP expiry/attempt tuning — tests shrink these to exercise the limits. */
  otpOptions?: IdentityOtpOptions;
}

/**
 * Composition root (MM-PLAN-001 §3.8): constructs the real application —
 * no listening, no telemetry init, no process wiring — so tests exercise
 * the deployable app rather than a hand-wired copy (MM-QA-001 F-05).
 * Fails fast if Postgres is unreachable: a single-instance API that cannot
 * reach its database has nothing to serve (readiness covers degradation
 * after boot).
 */
export async function buildServer(
  env: Env,
  overrides: BuildServerOverrides = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport: env.NODE_ENV === "development" ? { target: "pino-pretty" } : undefined,
    },
  });

  Sentry.setupFastifyErrorHandler(app);

  // Explicit allowlist, never reflection: this API carries Better Auth
  // cookie sessions from Phase 2, and `credentials: true` combined with a
  // reflected origin would be an authenticated-CSRF surface (ADR-0002,
  // MM-QA-001 F-04).
  await app.register(cors, {
    origin: env.CORS_ORIGINS,
    credentials: true,
  });

  const { db, pool, close } = createDb(env.DATABASE_URL);
  // Module event contracts and subscribers accumulate here from Phase 2 on.
  const registry =
    overrides.eventRegistry ??
    createEventRegistry([
      ...IDENTITY_EVENTS,
      ...DIRECTORY_EVENTS,
      ...BOOKING_EVENTS,
      ...CLINICAL_EVENTS,
    ]);
  const events = overrides.eventHandlers ?? createHandlerRegistry();
  const outbox = createOutboxEmitter(registry);
  const config = createConfigService(db);
  const dispatcher = createOutboxDispatcher({
    connectionString: env.DATABASE_URL,
    db,
    registry,
    handlers: events,
    log: app.log,
    pollIntervalMs: env.OUTBOX_POLL_INTERVAL_MS,
    workerPollIntervalS: env.OUTBOX_WORKER_POLL_INTERVAL_S,
    retryLimit: env.OUTBOX_RETRY_LIMIT,
    retryDelayS: env.OUTBOX_RETRY_DELAY_S,
  });

  const identity = createIdentityModule({
    db,
    config,
    outbox,
    log: app.log,
    env,
    otpChannels: overrides.otpChannels ?? {
      whatsapp: createMockOtpChannel("whatsapp"),
      sms: createMockOtpChannel("sms"),
    },
    emailChannel: overrides.emailChannel ?? createMockEmailChannel(),
    otpOptions: overrides.otpOptions,
  });
  registerAuthRoutes(app, identity.auth);

  // Module subscribers (§3.1): directory mirrors identity approval; search
  // maintains its read models from directory events; clinical creates
  // encounters from completed bookings — its only creation path.
  registerDirectorySubscribers({ events, outbox });
  registerSearchSubscribers(events);
  registerClinicalSubscribers({ events, outbox });

  app.get("/health", async () => healthPayload());
  app.get("/ready", async (_req, reply) => {
    const payload = await readinessPayload({ db, dispatcherStarted: dispatcher.isStarted });
    return reply.code(payload.status === "ready" ? 200 : 503).send(payload);
  });

  await app.register(fastifyTRPCPlugin, {
    prefix: "/trpc",
    trpcOptions: {
      router: createAppRouter(identity),
      createContext: createContextFactory({
        services: { db, config, outbox },
        sessionResolver: overrides.sessionResolver ?? identity.sessionResolver,
        defaultCountry: env.DEFAULT_COUNTRY,
      }),
    },
  });

  app.decorate("kernel", { db, pool, config, outbox, events, dispatcher, registry });
  app.decorate("identity", identity);

  app.addHook("onClose", async () => {
    await dispatcher.stop();
    await close();
  });

  await dispatcher.start();

  return app;
}
