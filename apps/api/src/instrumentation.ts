/**
 * Telemetry bootstrap. src/main.ts fully evaluates this module BEFORE the
 * server chunk loads, so the OTel/Sentry module-load hooks are installed
 * before fastify, pino, and node:http are first required (MM-QA-001
 * F-03/F-11, ADR-0002). test/otel.test.ts proves spans actually export;
 * if you reorder the bootstrap, that meta-test must still pass.
 */
import { loadEnv } from "./env.js";
import { startOtel } from "./kernel/otel.js";
import { initSentry } from "./kernel/sentry.js";

process.env.OTEL_SERVICE_NAME ??= "mesomed-api";

const env = loadEnv();
startOtel(env);
initSentry(env);
