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
  SENTRY_DSN: z.url().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
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
