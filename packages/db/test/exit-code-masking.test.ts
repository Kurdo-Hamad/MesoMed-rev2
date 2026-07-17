import { expect, it } from "vitest";
import { importEmbeddedPostgres } from "../src/testing/index.js";

/**
 * Guards the fix for the web-suite exit-code masking (ADR-0036).
 *
 * Importing embedded-postgres registers an async-exit-hook handler whose
 * `beforeExit` hook re-exits a cleanly-draining process with a hardcoded
 * exit code 0 — clobbering vitest's failure exit code (`process.exitCode =
 * 1`) whenever the embedded server runs in the MAIN vitest process, which
 * is exactly the web clinic harness (apps/web/test/global-setup.ts). Test
 * failures then vanish from turbo and the local gate.
 *
 * The guarded import must load the module while leaving `beforeExit`
 * exactly as it found it.
 */
it("importEmbeddedPostgres adds no beforeExit listener (exit-code masking guard)", async () => {
  const before = process.listeners("beforeExit").length;
  const mod = await importEmbeddedPostgres();
  expect(mod.default).toBeDefined();
  expect(process.listeners("beforeExit")).toHaveLength(before);
});
