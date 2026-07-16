import { spawn, type ChildProcessByStdio } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Readable } from "node:stream";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { domainEvents } from "@mesomed/db";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";

/**
 * Meta-test for ADR-0026 (Phase 10 Slice 3), sibling of otel.test.ts: the
 * real built artifact must export OTLP *metrics*, not just traces — the
 * outbox lag / dead-letter gauges observed from the DB, and the HTTP
 * server latency histogram behind the p95 dashboards. Runs dist/main.js
 * against a mock OTLP collector capturing /v1/metrics.
 */
const API_PORT = 43119;
const apiDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const metricBodies: Buffer[] = [];
let tdb: TestDatabase;
let collector: http.Server;
let api: ChildProcessByStdio<null, Readable, Readable>;
let apiOutput = "";
let apiExited: Promise<number | null>;

async function waitForHealth(): Promise<void> {
  for (let attempt = 0; attempt < 550; attempt++) {
    try {
      const res = await fetch(`http://127.0.0.1:${API_PORT}/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`API never became healthy. Output:\n${apiOutput}`);
}

interface ExportedMetric {
  name: string;
  gauge?: { dataPoints?: { asDouble?: number; asInt?: string | number }[] };
  histogram?: { dataPoints?: unknown[] };
  sum?: { dataPoints?: unknown[] };
}

function exportedMetrics(): ExportedMetric[] {
  return metricBodies.flatMap((body) => {
    const payload = JSON.parse(body.toString()) as {
      resourceMetrics?: { scopeMetrics?: { metrics?: ExportedMetric[] }[] }[];
    };
    return (payload.resourceMetrics ?? [])
      .flatMap((rm) => rm.scopeMetrics ?? [])
      .flatMap((scope) => scope.metrics ?? []);
  });
}

function gaugeValue(name: string): number | undefined {
  const metric = exportedMetrics()
    .filter((m) => m.name === name)
    .at(-1);
  const point = metric?.gauge?.dataPoints?.at(-1);
  if (!point) return undefined;
  return point.asDouble ?? Number(point.asInt);
}

beforeAll(async () => {
  tdb = await createTestDatabase();

  // Seeded outbox state the gauges must report: one pending row two
  // minutes old (lag), one dead row (depth). OUTBOX_POLL_INTERVAL_MS below
  // is set high so the dispatcher never pumps the pending row mid-test.
  await tdb.db.insert(domainEvents).values([
    {
      name: "booking.booked.v1",
      version: 1,
      aggregateType: "appointment",
      aggregateId: "metrics-test-pending",
      payload: {},
      occurredAt: new Date(Date.now() - 120_000),
      status: "pending",
    },
    {
      name: "booking.booked.v1",
      version: 1,
      aggregateType: "appointment",
      aggregateId: "metrics-test-dead",
      payload: {},
      status: "dead",
    },
  ]);

  collector = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      if (req.url === "/v1/metrics") metricBodies.push(Buffer.concat(chunks));
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise<void>((resolve) => collector.listen(0, resolve));
  const collectorPort = (collector.address() as AddressInfo).port;

  api = spawn(process.execPath, [path.join(apiDir, "dist", "main.js")], {
    cwd: apiDir,
    env: {
      ...process.env,
      NODE_ENV: "production",
      LOG_LEVEL: "silent",
      PORT: String(API_PORT),
      DATABASE_URL: tdb.connectionString,
      BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0000",
      OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${collectorPort}`,
      // Fast export so the assertion window stays short (standard OTel var).
      OTEL_METRIC_EXPORT_INTERVAL: "1000",
      // Keep the dispatcher from pumping the seeded pending row.
      OUTBOX_POLL_INTERVAL_MS: "600000",
      // Fake credentials for every channel so the mock-production
      // guardrail (ADR-0011) doesn't block the boot (as in otel.test.ts).
      WHATSAPP_ACCESS_TOKEN: "fake-whatsapp-token",
      WHATSAPP_PHONE_NUMBER_ID: "fake-phone-number-id",
      TWILIO_ACCOUNT_SID: "fake-account-sid",
      TWILIO_AUTH_TOKEN: "fake-auth-token",
      TWILIO_FROM: "+10000000000",
      RESEND_API_KEY: "fake-resend-key",
      RESEND_FROM: "noreply@example.test",
      EXPO_PUSH_ACCESS_TOKEN: "fake-expo-token",
      ANTHROPIC_API_KEY: "fake-anthropic-key",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  api.stdout.on("data", (chunk: Buffer) => (apiOutput += chunk.toString()));
  api.stderr.on("data", (chunk: Buffer) => (apiOutput += chunk.toString()));
  apiExited = new Promise((resolve) => api.on("exit", (code) => resolve(code)));

  await waitForHealth();
}, 60_000);

afterAll(async () => {
  if (api && api.exitCode === null) api.kill("SIGKILL");
  if (collector) await new Promise<void>((resolve) => collector.close(() => resolve()));
  if (tdb) await tdb.close();
});

describe("opentelemetry metrics export", () => {
  it("exports outbox gauges and an HTTP latency histogram", async () => {
    // Traffic for the HTTP histogram.
    for (let i = 0; i < 3; i++) {
      const res = await fetch(`http://127.0.0.1:${API_PORT}/trpc/health.check`);
      expect(res.status).toBe(200);
    }

    // Wait until an export containing the outbox gauges has arrived
    // (1s interval; generous ceiling for slow CI).
    for (let attempt = 0; attempt < 300; attempt++) {
      if (gaugeValue("mesomed.outbox.pending") !== undefined) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    expect(gaugeValue("mesomed.outbox.pending")).toBe(1);
    expect(gaugeValue("mesomed.outbox.dead")).toBe(1);
    // Seeded two minutes ago; anything ≥ 100s proves the DB-derived lag.
    expect(gaugeValue("mesomed.outbox.lag_seconds")).toBeGreaterThan(100);

    // The p95 source: the auto-instrumentation's HTTP server duration
    // histogram (name differs across semconv generations — accept either).
    if (process.platform === "win32") {
      api.kill("SIGKILL");
      await apiExited;
    } else {
      api.kill("SIGTERM");
      const exitCode = await apiExited;
      expect(exitCode).toBe(0);
    }

    const histogramNames = exportedMetrics()
      .filter((m) => (m.histogram?.dataPoints?.length ?? 0) > 0)
      .map((m) => m.name);
    expect(
      histogramNames.some(
        (name) => name === "http.server.duration" || name === "http.server.request.duration",
      ),
      `no HTTP server duration histogram among: ${histogramNames.join(", ")}`,
    ).toBe(true);
  }, 90_000);
});
