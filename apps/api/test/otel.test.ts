import { spawn, type ChildProcessByStdio } from "node:child_process";
import http from "node:http";
import type { Readable } from "node:stream";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";

/**
 * Meta-test for MM-QA-001 F-03: telemetry must demonstrably export trace
 * spans, not merely initialize. Phase 0's bootstrap started the SDK after
 * fastify/http were already loaded — six live requests exported zero spans
 * and only pino log records arrived. This test runs the real built
 * artifact (dist/main.js — the same file the Docker image executes)
 * against a mock OTLP collector and fails if no span reaches /v1/traces.
 */
const API_PORT = 43117;
const apiDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const traceBodies: Buffer[] = [];
let tdb: TestDatabase | undefined;
let collector: http.Server | undefined;
let api: ChildProcessByStdio<null, Readable, Readable> | undefined;
let apiOutput = "";
let apiExited: Promise<number | null>;

async function waitForHealth(): Promise<void> {
  // Generous ceiling: under a fully parallel local run every suite boots its
  // own embedded Postgres, and the artifact's cold boot can exceed 15s.
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

beforeAll(async () => {
  // The artifact under test is the real server: it refuses to boot without
  // its database, so the meta-test provisions one like any deployment.
  tdb = await createTestDatabase();

  collector = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      if (req.url === "/v1/traces") traceBodies.push(Buffer.concat(chunks));
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  // Ephemeral port (0), not a hardcoded one: CI run 29212913871 failed with
  // EADDRINUSE on a fixed collector port already held by another process on
  // the runner — beforeAll hung to the hook timeout and afterAll threw
  // because `api` was never assigned. Binding to 0 and reading back the
  // OS-assigned port removes the collision entirely.
  const server = collector;
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const collectorPort = (server.address() as { port: number }).port;

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
      // This test's NODE_ENV=production boots the real artifact to prove
      // OTel export, not to exercise adapter selection — supply (fake)
      // credentials for every channel so the mock-production guardrail
      // (ADR-0011) doesn't block the boot it's testing.
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
  const proc = api;
  proc.stdout.on("data", (chunk: Buffer) => (apiOutput += chunk.toString()));
  proc.stderr.on("data", (chunk: Buffer) => (apiOutput += chunk.toString()));
  apiExited = new Promise((resolve) => proc.on("exit", (code) => resolve(code)));

  await waitForHealth();
}, 60_000);

afterAll(async () => {
  // Defensive: beforeAll can fail partway through (e.g. the EADDRINUSE flake
  // this guarded against), leaving later fields unassigned — teardown must
  // not throw on top of an already-failed setup.
  if (api && api.exitCode === null) api.kill("SIGKILL");
  if (collector) {
    const srv = collector;
    await new Promise<void>((resolve) => srv.close(() => resolve()));
  }
  if (tdb) await tdb.close();
});

describe("opentelemetry export", () => {
  it("exports real trace spans to the collector and shuts down cleanly", async () => {
    if (!api) throw new Error("beforeAll did not assign the api process");
    const proc = api;

    for (let i = 0; i < 3; i++) {
      const res = await fetch(`http://127.0.0.1:${API_PORT}/trpc/health.check`);
      expect(res.status).toBe(200);
    }

    // SIGTERM triggers the hardened shutdown path, which force-flushes the
    // batch span processor — so span arrival is deterministic, and exit
    // code 0 proves graceful teardown (MM-QA-001 F-12). Windows has no
    // signal delivery (kill() is TerminateProcess), so there the test waits
    // for the batch processor's scheduled export instead and the graceful
    // exit-code assertion runs only where signals exist — CI (linux) always
    // enforces it.
    if (process.platform === "win32") {
      for (let attempt = 0; attempt < 150 && traceBodies.length === 0; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      proc.kill("SIGKILL");
      await apiExited;
    } else {
      proc.kill("SIGTERM");
      const exitCode = await apiExited;
      expect(exitCode).toBe(0);
    }

    expect(traceBodies.length).toBeGreaterThan(0);

    const payload = JSON.parse(Buffer.concat(traceBodies).toString()) as {
      resourceSpans?: {
        resource?: { attributes?: { key: string; value?: { stringValue?: string } }[] };
        scopeSpans?: { spans?: unknown[] }[];
      }[];
    };
    const resourceSpans = payload.resourceSpans ?? [];
    expect(resourceSpans.length).toBeGreaterThan(0);

    const serviceName = resourceSpans[0]?.resource?.attributes?.find(
      (attribute) => attribute.key === "service.name",
    )?.value?.stringValue;
    expect(serviceName).toBe("mesomed-api");

    const spanCount = resourceSpans
      .flatMap((rs) => rs.scopeSpans ?? [])
      .flatMap((scope) => scope.spans ?? []).length;
    expect(spanCount).toBeGreaterThan(0);
  }, 60_000);
});
