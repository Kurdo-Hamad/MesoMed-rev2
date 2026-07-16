import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
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
  // and appends the per-signal path (/v1/traces, /v1/metrics). A manually
  // passed base URL is used verbatim and would miss the path (MM-QA-001 F-03).
  sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter(),
    // Registers a global MeterProvider, which (a) makes the kernel/metrics.ts
    // instruments real instead of no-ops and (b) turns on the HTTP server
    // latency histograms from the auto-instrumentation — the p95 source for
    // the Phase 10 dashboards (ADR-0026). OTEL_METRIC_EXPORT_INTERVAL is the
    // standard OTel env var (ms, default 60000).
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
      exportIntervalMillis: Number(process.env.OTEL_METRIC_EXPORT_INTERVAL ?? 60_000),
    }),
    instrumentations: [getNodeAutoInstrumentations()],
  });
  sdk.start();
}

export async function shutdownOtel(): Promise<void> {
  await sdk?.shutdown();
}
