import { metrics } from "@opentelemetry/api";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";

/**
 * Must be the FIRST import of any test that asserts on kernel metrics:
 * the OTel metrics API has no proxy provider (unlike tracing), so a meter
 * obtained before setGlobalMeterProvider() is a no-op forever. Production
 * has the same constraint, satisfied by the src/main.ts bootstrap order
 * (instrumentation.ts starts the SDK before app modules load, MM-QA-001
 * F-03) — this module is the test-side equivalent.
 */
export const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
export const metricProvider = new MeterProvider({
  readers: [
    // The huge interval disables scheduled export; forceFlush() drives it.
    new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: 3_600_000,
    }),
  ],
});
metrics.setGlobalMeterProvider(metricProvider);
