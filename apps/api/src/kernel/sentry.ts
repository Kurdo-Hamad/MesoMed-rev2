import * as Sentry from "@sentry/node";
import type { Env } from "../env.js";

/** No-ops when SENTRY_DSN is unset — no account required in dev/CI. */
export function initSentry(env: Env): void {
  if (!env.SENTRY_DSN) return;

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: env.NODE_ENV === "production" ? 0.1 : 1.0,
  });
}
