import type { FastifyRequest } from "fastify";
import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";
import type { Role } from "@mesomed/contracts/roles";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@mesomed/contracts/i18n";
import type { Db } from "@mesomed/db";
import type { ConfigService } from "./config.js";
import type { OutboxEmitter } from "./outbox.js";

/**
 * Minimal session shape the kernel needs for authorization. Phase 2 mounts
 * Better Auth and supplies the real resolver in the composition root; until
 * then the default resolver treats every request as anonymous.
 */
export interface Session {
  userId: string;
  roles: readonly Role[];
}

export type SessionResolver = (req: FastifyRequest) => Session | null | Promise<Session | null>;

export const anonymousSessionResolver: SessionResolver = () => null;

/** Services the kernel wires once per process and hands to every request. */
export interface KernelRequestServices {
  db: Db;
  config: ConfigService;
  outbox: OutboxEmitter;
}

/** Request-scoped context (MM-PLAN-001 §5 Phase 1): session, locale, country. */
export interface Context extends KernelRequestServices {
  requestId: string;
  session: Session | null;
  locale: Locale;
  country: string;
}

export const LOCALE_HEADER = "x-mesomed-locale";
export const COUNTRY_HEADER = "x-mesomed-country";

function requestLocale(req: FastifyRequest): Locale {
  const header = req.headers[LOCALE_HEADER];
  const value = Array.isArray(header) ? header[0] : header;
  return value !== undefined && isLocale(value) ? value : DEFAULT_LOCALE;
}

function requestCountry(req: FastifyRequest, fallback: string): string {
  const header = req.headers[COUNTRY_HEADER];
  const value = Array.isArray(header) ? header[0] : header;
  return value !== undefined && /^[A-Za-z]{2}$/.test(value) ? value.toUpperCase() : fallback;
}

export function createContextFactory(deps: {
  services: KernelRequestServices;
  sessionResolver: SessionResolver;
  defaultCountry: string;
}) {
  return async ({ req }: CreateFastifyContextOptions): Promise<Context> => ({
    ...deps.services,
    requestId: req.id,
    session: await deps.sessionResolver(req),
    locale: requestLocale(req),
    country: requestCountry(req, deps.defaultCountry),
  });
}
