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
  SENTRY_DSN: z.url().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
  // Better Auth (Phase 2): secret signs session tokens — required, no
  // default, so a production boot can never fall back to a known value.
  BETTER_AUTH_SECRET: z.string().min(32, "at least 32 characters"),
  // Public base URL of this API, used by Better Auth for callback/link URLs.
  BETTER_AUTH_URL: z.url().default("http://localhost:4000"),
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
