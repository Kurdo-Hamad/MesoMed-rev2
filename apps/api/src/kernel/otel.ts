import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import type { Env } from "../env.js";

let sdk: NodeSDK | undefined;

/**
 * No-ops when no OTLP endpoint is configured — no collector required in
 * dev/CI. Must run before fastify/pino/http enter the module cache (see
 * src/main.ts): patch-based instrumentation cannot retrofit modules that
 * are already loaded (MM-QA-001 F-03).
 */
export function startOtel(env: Env): void {
  if (!env.OTEL_EXPORTER_OTLP_ENDPOINT) return;

  // No explicit `url`: the exporter reads OTEL_EXPORTER_OTLP_ENDPOINT itself
  // and appends the per-signal path (/v1/traces). A manually passed base URL
  // is used verbatim and would miss the path (MM-QA-001 F-03).
  sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [getNodeAutoInstrumentations()],
  });
  sdk.start();
}

export async function shutdownOtel(): Promise<void> {
  await sdk?.shutdown();
}
