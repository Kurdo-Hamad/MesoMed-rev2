import { spawn, type ChildProcessByStdio } from "node:child_process";
import http from "node:http";
import type { Readable } from "node:stream";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Meta-test for MM-QA-001 F-03: telemetry must demonstrably export trace
 * spans, not merely initialize. Phase 0's bootstrap started the SDK after
 * fastify/http were already loaded — six live requests exported zero spans
 * and only pino log records arrived. This test runs the real built
 * artifact (dist/main.js — the same file the Docker image executes)
 * against a mock OTLP collector and fails if no span reaches /v1/traces.
 */
const API_PORT = 43117;
const COLLECTOR_PORT = 43118;
const apiDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const traceBodies: Buffer[] = [];
let collector: http.Server;
let api: ChildProcessByStdio<null, Readable, Readable>;
let apiOutput = "";
let apiExited: Promise<number | null>;

async function waitForHealth(): Promise<void> {
  for (let attempt = 0; attempt < 150; attempt++) {
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
  collector = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      if (req.url === "/v1/traces") traceBodies.push(Buffer.concat(chunks));
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise<void>((resolve) => collector.listen(COLLECTOR_PORT, resolve));

  api = spawn(process.execPath, [path.join(apiDir, "dist", "main.js")], {
    cwd: apiDir,
    env: {
      ...process.env,
      NODE_ENV: "production",
      LOG_LEVEL: "silent",
      PORT: String(API_PORT),
      OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${COLLECTOR_PORT}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  api.stdout.on("data", (chunk: Buffer) => (apiOutput += chunk.toString()));
  api.stderr.on("data", (chunk: Buffer) => (apiOutput += chunk.toString()));
  apiExited = new Promise((resolve) => api.on("exit", (code) => resolve(code)));

  await waitForHealth();
}, 60_000);

afterAll(async () => {
  if (api.exitCode === null) api.kill("SIGKILL");
  await new Promise<void>((resolve) => collector.close(() => resolve()));
});

describe("opentelemetry export", () => {
  it("exports real trace spans to the collector and shuts down cleanly", async () => {
    for (let i = 0; i < 3; i++) {
      const res = await fetch(`http://127.0.0.1:${API_PORT}/trpc/health.check`);
      expect(res.status).toBe(200);
    }

    // SIGTERM triggers the hardened shutdown path, which force-flushes the
    // batch span processor — so span arrival is deterministic, and exit
    // code 0 proves graceful teardown (MM-QA-001 F-12).
    api.kill("SIGTERM");
    const exitCode = await apiExited;
    expect(exitCode).toBe(0);

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
