import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // 4000 by default: 3000 belongs to `next dev`, 8081 to the Expo dev server
  // (MM-QA-001 F-06 — the three dev processes must never race for a port).
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  // Explicit origin allowlist, comma-separated. Never a wildcard and never
  // reflected: this API carries cookie credentials from Phase 2 (ADR-0002).
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:3000,http://localhost:8081")
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  // Postgres connection for Drizzle and pg-boss. Required: the API refuses
  // to boot without its database rather than serving half-alive.
  DATABASE_URL: z.string().min(1),
  // Country a request is attributed to when the client sends none.
  // Country/category enablement itself is config-table data (§3.9).
  DEFAULT_COUNTRY: z
    .string()
    .regex(/^[A-Z]{2}$/, "ISO 3166-1 alpha-2, uppercase")
    .default("IQ"),
  // Outbox dispatcher tuning. Defaults suit production; tests turn them
  // down to keep forced-retry scenarios fast.
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(50).default(1_000),
  OUTBOX_WORKER_POLL_INTERVAL_S: z.coerce.number().min(0.5).default(2),
  OUTBOX_RETRY_LIMIT: z.coerce.number().int().min(0).default(5),
  OUTBOX_RETRY_DELAY_S: z.coerce.number().int().min(0).default(2),
  // Payment webhook rate limiting (Phase 6). Applies to the webhook scope
  // only; sized for gateway retry storms, tuned down in tests.
  WEBHOOK_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(120),
  WEBHOOK_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).default(60_000),
  // Fastify `trustProxy` (ADR-0011 F-5): unset/"false" trusts nothing — every
  // caller's `req.ip` is the socket peer. Behind a reverse proxy/load
  // balancer (the expected production topology), leaving this false means
  // every request shares the proxy's IP, collapsing per-IP guardrails
  // (identity OTP send, AI triage rate limits) onto one shared bucket for
  // ALL callers — an accidental denial-of-service, not just a missed limit.
  // "true" trusts X-Forwarded-For unconditionally (only correct with NO
  // direct public access to this process); a comma-separated IP/CIDR list
  // trusts only those hops (the deployment's own proxy addresses) — the
  // correct setting whenever direct access is also possible.
  TRUST_PROXY: z.string().optional(),
  SENTRY_DSN: z.url().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
  // Better Auth (Phase 2): secret signs session tokens — required, no
  // default, so a production boot can never fall back to a known value.
  BETTER_AUTH_SECRET: z.string().min(32, "at least 32 characters"),
  // Public base URL of this API, used by Better Auth for callback/link URLs.
  BETTER_AUTH_URL: z.url().default("http://localhost:4000"),

  // Phase 7 real-channel adapter credentials (all optional): the
  // composition root wires the real adapter when its credentials are
  // present and the mock otherwise — never partially, per channel.
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_GRAPH_BASE_URL: z.url().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM: z.string().optional(),
  EXPO_PUSH_ACCESS_TOKEN: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_TRIAGE_MODEL: z.string().optional(),
  // Next-day reminder cron (pg-boss schedule syntax).
  REMINDER_CRON: z.string().default("0 6 * * *"),
  // Data-retention prune (Phase 10 Slice 6, ADR-0028): daily cron; windows
  // per ADR-0011 (notification_log 12–24 months → 540d default) and the
  // send_rate_events schema comment (days-scale → 7d default).
  RETENTION_CRON: z.string().default("30 2 * * *"),
  RETENTION_NOTIFICATION_LOG_DAYS: z.coerce.number().int().min(365).default(540),
  RETENTION_SEND_RATE_EVENTS_DAYS: z.coerce.number().int().min(1).default(7),
  // Notification sender tuning — mirrors the outbox dispatcher's own knobs.
  NOTIFICATION_POLL_INTERVAL_MS: z.coerce.number().int().min(50).default(5_000),
  NOTIFICATION_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),
  NOTIFICATION_RETRY_DELAY_S: z.coerce.number().int().min(0).default(60),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    console.error("Invalid environment configuration:", z.treeifyError(result.error));
    throw new Error("Invalid environment configuration");
  }
  return result.data;
}
