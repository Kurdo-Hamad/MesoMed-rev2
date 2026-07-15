import type { TestProject } from "vitest/node";
import { setupWebClinicHarness, type WebClinicHarness } from "./clinic-fixture.js";

/**
 * The clinic harness (embedded Postgres + the real API server) is
 * node-only — @mesomed/db/testing cannot load inside the jsdom render
 * suite. It starts here, in vitest's node-side global setup, and the
 * suites reach it via injected coordinates + the HTTP-only helpers in
 * clinic-client.ts.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const harness: WebClinicHarness = await setupWebClinicHarness();
  project.provide("clinicBaseURL", harness.baseURL);
  project.provide("clinicDoctorLocationId", harness.doctorLocationId);
  return async () => {
    await harness.close();
  };
}
