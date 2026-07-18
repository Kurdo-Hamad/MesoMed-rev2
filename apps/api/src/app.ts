import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import * as Sentry from "@sentry/node";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import { createEventRegistry, type EventRegistry } from "@mesomed/contracts/events";
import { IDENTITY_EVENTS } from "@mesomed/contracts/events/identity";
import { DIRECTORY_EVENTS } from "@mesomed/contracts/events/directory";
import { BOOKING_EVENTS } from "@mesomed/contracts/events/booking";
import { CLINICAL_EVENTS } from "@mesomed/contracts/events/clinical";
import { BILLING_EVENTS } from "@mesomed/contracts/events/billing";
import { API_DB_TIMEOUTS, createDb, type Db } from "@mesomed/db";
import { locales } from "@mesomed/i18n";
import {
  createManualPaymentGateway,
  createMockAiGateway,
  createMockEmailChannel,
  createMockNotifyChannel,
  createMockOtpChannel,
  createMockPushChannel,
  isMockAdapter,
  MANUAL_GATEWAY_ID,
  type AiGateway,
  type EmailChannel,
  type NotifyChannel,
  type PushChannel,
} from "@mesomed/platform";
import {
  createAnthropicAiGateway,
  createExpoPushAdapter,
  createMetaWhatsAppAdapter,
  createResendEmailAdapter,
  createTwilioSmsAdapter,
} from "@mesomed/platform/adapters";
import type pg from "pg";
import type { Env } from "./env.js";
import { createContextFactory, type SessionResolver } from "./kernel/context.js";
import { createConfigService, type ConfigService } from "./kernel/config.js";
import { createInMemoryCache, type CacheAdapter } from "./kernel/cache.js";
import { createOutboxDispatcher, type OutboxDispatcher } from "./kernel/dispatcher.js";
import { createHandlerRegistry, type HandlerRegistry } from "./kernel/events.js";
import { healthPayload, readinessPayload } from "./kernel/health.js";
import { createJobScheduler, type JobScheduler } from "./kernel/jobs.js";
import { createOutboxEmitter, type OutboxEmitter } from "./kernel/outbox.js";
import { registerOutboxMetrics, registerSearchMetrics } from "./kernel/metrics.js";
import { REDACT_PATHS } from "./kernel/redaction.js";
import { registerPaymentWebhookRoutes } from "./modules/billing/webhook.js";
import { registerBillingSubscribers } from "./modules/billing/index.js";
import type { PaymentGatewayRegistry } from "./modules/billing/shared.js";
import { registerClinicalSubscribers } from "./modules/clinical/index.js";
import { registerCommunicationSubscribers } from "./modules/communication/index.js";
import { planNextDayReminders } from "./modules/communication/reminders.js";
import { pruneNotificationLog } from "./modules/communication/retention.js";
import { pruneSendRateEvents } from "./kernel/abuse.js";
import {
  createNotificationSender,
  type NotificationChannels,
  type NotificationSender,
} from "./modules/communication/sender.js";
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
  cache: CacheAdapter;
}

declare module "fastify" {
  interface FastifyInstance {
    kernel: KernelServices;
    identity: IdentityModule;
    /** Wired gateway adapters — exposed for the dev/e2e harness fixtures. */
    paymentGateways: PaymentGatewayRegistry;
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
  /** OTP transports (mock by default through Phase 2 — MM-DEC rev02 §8; real Meta/Twilio when configured). */
  otpChannels?: OtpChannels;
  /** Email transport (mock by default through Phase 2; real Resend when configured). */
  emailChannel?: EmailChannel;
  /** OTP expiry/attempt tuning — tests shrink these to exercise the limits. */
  otpOptions?: IdentityOtpOptions;
  /**
   * Payment gateway adapters keyed by id (Phase 6). Default wires the
   * complete `manual` gateway only; FIB/ZainCash adapters join here when
   * their integrations are real (§8) — tests inject fakes to exercise the
   * webhook signature/idempotency paths.
   */
  paymentGateways?: PaymentGatewayRegistry;
  /** Triage model gateway (mock by default; real Anthropic when configured). */
  aiGateway?: AiGateway;
  /** Communication whatsapp/sms transports (mock by default; real Meta/Twilio when configured). */
  notifyChannels?: { whatsapp: NotifyChannel; sms: NotifyChannel };
  /** Communication push transport (mock by default; real Expo when configured). */
  pushChannel?: PushChannel;
}

const OTP_MESSAGE_CATALOG: Record<string, string> = {
  en: locales.en.identity.otp.message,
  ar: locales.ar.identity.otp.message,
  ckb: locales.ckb.identity.otp.message,
};

/**
 * Real-vs-mock adapter resolution (§3.8): each channel is wired to its
 * real vendor adapter only when ITS OWN credentials are present in the
 * environment — never a partial/best-effort mix. Everything else falls
 * back to the mock. No I/O happens here (adapter construction is lazy;
 * the first network call is the caller's first `.send()`/`.generate()`).
 */
function resolveAdapters(env: Env, overrides: BuildServerOverrides) {
  const whatsapp =
    env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID
      ? createMetaWhatsAppAdapter(
          {
            accessToken: env.WHATSAPP_ACCESS_TOKEN,
            phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
            baseUrl: env.WHATSAPP_GRAPH_BASE_URL,
          },
          OTP_MESSAGE_CATALOG,
        )
      : { notify: createMockNotifyChannel("whatsapp"), otp: createMockOtpChannel("whatsapp") };

  const sms =
    env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM
      ? createTwilioSmsAdapter(
          {
            accountSid: env.TWILIO_ACCOUNT_SID,
            authToken: env.TWILIO_AUTH_TOKEN,
            from: env.TWILIO_FROM,
          },
          OTP_MESSAGE_CATALOG,
        )
      : { notify: createMockNotifyChannel("sms"), otp: createMockOtpChannel("sms") };

  const otpChannels: OtpChannels = overrides.otpChannels ?? {
    whatsapp: whatsapp.otp,
    sms: sms.otp,
  };
  const notifyChannels = overrides.notifyChannels ?? { whatsapp: whatsapp.notify, sms: sms.notify };

  const pushChannel: PushChannel =
    overrides.pushChannel ??
    (env.EXPO_PUSH_ACCESS_TOKEN
      ? createExpoPushAdapter({ accessToken: env.EXPO_PUSH_ACCESS_TOKEN })
      : createMockPushChannel());

  const emailChannel: EmailChannel =
    overrides.emailChannel ??
    (env.RESEND_API_KEY && env.RESEND_FROM
      ? createResendEmailAdapter({ apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM })
      : createMockEmailChannel());

  const aiGateway: AiGateway =
    overrides.aiGateway ??
    (env.ANTHROPIC_API_KEY
      ? createAnthropicAiGateway({ apiKey: env.ANTHROPIC_API_KEY, model: env.AI_TRIAGE_MODEL })
      : createMockAiGateway());

  return { otpChannels, notifyChannels, pushChannel, emailChannel, aiGateway };
}

/**
 * Mock→real production guardrail (MM-ARC-002 Document 12): a mock adapter
 * silently "delivering" in production is worse than a boot failure — no
 * OTP reaches a patient, no charge notice reaches a provider, but nothing
 * looks broken. Runs before any I/O (Fastify app creation, DB connection).
 */
function assertNoMockAdaptersInProduction(
  env: Env,
  adapters: ReturnType<typeof resolveAdapters>,
): void {
  if (env.NODE_ENV !== "production") return;
  const named: Array<[string, unknown]> = [
    ["identity OTP whatsapp channel", adapters.otpChannels.whatsapp],
    ["identity OTP sms channel", adapters.otpChannels.sms],
    ["email channel", adapters.emailChannel],
    ["communication whatsapp channel", adapters.notifyChannels.whatsapp],
    ["communication sms channel", adapters.notifyChannels.sms],
    ["communication push channel", adapters.pushChannel],
    ["AI triage gateway", adapters.aiGateway],
  ];
  const mock = named.find(([, adapter]) => isMockAdapter(adapter));
  if (mock) {
    throw new Error(
      `Refusing to boot in production with a mock adapter wired: ${mock[0]}. ` +
        "Set its credentials in the environment (see .env.example).",
    );
  }
}

/**
 * Resolves `TRUST_PROXY` (ADR-0011 F-5) into the shape Fastify's own option
 * accepts: unset/"false" → false (trust nothing, `req.ip` is the socket
 * peer); "true" → true (trust every hop's X-Forwarded-For — only correct
 * with no direct public access); anything else → a comma-separated
 * IP/CIDR allowlist of the deployment's own proxy addresses.
 */
export function resolveTrustProxy(value: string | undefined): boolean | string[] {
  if (!value || value === "false") return false;
  if (value === "true") return true;
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
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
  // Adapter resolution + the production guardrail run before any I/O —
  // before the Fastify app itself, the DB pool, or the outbox/scheduler.
  const adapters = resolveAdapters(env, overrides);
  assertNoMockAdaptersInProduction(env, adapters);

  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport: env.NODE_ENV === "development" ? { target: "pino-pretty" } : undefined,
      redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    },
    trustProxy: resolveTrustProxy(env.TRUST_PROXY),
    // tRPC batched GETs put every procedure name in ONE comma-joined path
    // param; Fastify's 100-char default 414s any batch of ≥6 procedures
    // (observed: 7 rapid clinic day-shifts → FST_ERR_MAX_PARAM_LENGTH).
    // 4096 covers ~200 batched procedures — far beyond any real client.
    maxParamLength: 4096,
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

  // F-11 (ADR-0045): pool-level timeout fallback — primary enforcement is
  // role-level on mesomed_api (migration 0011); this holds the same bounds
  // whatever role DATABASE_URL logs in as.
  const { db, pool, close } = createDb(env.DATABASE_URL, { timeouts: API_DB_TIMEOUTS });
  // Outbox lag / dead-letter gauges, observed at each metric export
  // (ADR-0026). No-op unless an OTel SDK is running (kernel/otel.ts).
  registerOutboxMetrics(db);
  registerSearchMetrics(db);
  // Module event contracts and subscribers accumulate here from Phase 2 on.
  const registry =
    overrides.eventRegistry ??
    createEventRegistry([
      ...IDENTITY_EVENTS,
      ...DIRECTORY_EVENTS,
      ...BOOKING_EVENTS,
      ...CLINICAL_EVENTS,
      ...BILLING_EVENTS,
    ]);
  const events = overrides.eventHandlers ?? createHandlerRegistry();
  const outbox = createOutboxEmitter(registry);
  const config = createConfigService(db);
  const cache = createInMemoryCache();
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
    otpChannels: adapters.otpChannels,
    emailChannel: adapters.emailChannel,
    otpOptions: overrides.otpOptions,
  });
  registerAuthRoutes(app, identity.auth);

  // Payment gateway adapters (§3.8): concrete providers wired here only.
  const paymentGateways: PaymentGatewayRegistry = overrides.paymentGateways ?? {
    [MANUAL_GATEWAY_ID]: createManualPaymentGateway(),
  };
  await registerPaymentWebhookRoutes(app, {
    db,
    outbox,
    gateways: paymentGateways,
    rateLimit: {
      max: env.WEBHOOK_RATE_LIMIT_MAX,
      timeWindowMs: env.WEBHOOK_RATE_LIMIT_WINDOW_MS,
    },
  });

  // Module subscribers (§3.1): directory mirrors identity approval and
  // billing subscription/tier state; search maintains its read models from
  // directory events; clinical creates encounters from completed bookings —
  // its only creation path; billing accrues per-booking charges from
  // completed bookings and policy-evaluates cancellations/no-shows (Phase
  // 6b — patient collection dormant behind config).
  registerDirectorySubscribers({ events, outbox, cache });
  registerSearchSubscribers(events);
  registerClinicalSubscribers({ events, outbox });
  registerBillingSubscribers({ events, outbox, config, gateways: paymentGateways });
  registerCommunicationSubscribers({ events });

  // Notification sender (§5 Phase 7): polls notification_log for due rows
  // and delivers via the resolved (real-or-mock) channels above.
  const notificationChannels: NotificationChannels = {
    whatsapp: adapters.notifyChannels.whatsapp,
    sms: adapters.notifyChannels.sms,
    push: adapters.pushChannel,
    email: adapters.emailChannel,
  };
  const notificationSender: NotificationSender = createNotificationSender({
    db,
    config,
    log: app.log,
    channels: notificationChannels,
    pollIntervalMs: env.NOTIFICATION_POLL_INTERVAL_MS,
    maxAttempts: env.NOTIFICATION_MAX_ATTEMPTS,
    backoffSeconds: env.NOTIFICATION_RETRY_DELAY_S,
  });
  notificationSender.start();

  // Next-day reminder cron: a second, separate pg-boss instance (its own
  // `schedule: true` opt-in — see kernel/jobs.ts) from the outbox
  // dispatcher's queue instance.
  const jobScheduler: JobScheduler = createJobScheduler({
    connectionString: env.DATABASE_URL,
    log: app.log,
  });
  await jobScheduler.start();
  await jobScheduler.schedule("communication-reminders", env.REMINDER_CRON, async () => {
    await planNextDayReminders(db, new Date());
  });
  // Data-retention prune (ADR-0028): each module prunes its own tables
  // (convention #1) — communication's notification_log, the kernel's
  // send-rate ledger.
  await jobScheduler.schedule("data-retention-prune", env.RETENTION_CRON, async () => {
    const notifications = await pruneNotificationLog(db, env.RETENTION_NOTIFICATION_LOG_DAYS);
    const rateEvents = await pruneSendRateEvents(db, env.RETENTION_SEND_RATE_EVENTS_DAYS);
    app.log.info({ notifications, rateEvents }, "data-retention prune completed");
  });

  app.get("/health", async () => healthPayload());
  app.get("/ready", async (_req, reply) => {
    const payload = await readinessPayload({ db, dispatcherStarted: dispatcher.isStarted });
    return reply.code(payload.status === "ready" ? 200 : 503).send(payload);
  });

  await app.register(fastifyTRPCPlugin, {
    prefix: "/trpc",
    trpcOptions: {
      router: createAppRouter(identity, { paymentGateways, ai: adapters.aiGateway }),
      createContext: createContextFactory({
        services: { db, config, outbox, cache },
        sessionResolver: overrides.sessionResolver ?? identity.sessionResolver,
        defaultCountry: env.DEFAULT_COUNTRY,
      }),
    },
  });

  app.decorate("kernel", { db, pool, config, outbox, events, dispatcher, registry, cache });
  app.decorate("identity", identity);
  app.decorate("paymentGateways", paymentGateways);

  app.addHook("onClose", async () => {
    await notificationSender.stop();
    await jobScheduler.stop();
    await dispatcher.stop();
    await close();
  });

  await dispatcher.start();

  return app;
}
