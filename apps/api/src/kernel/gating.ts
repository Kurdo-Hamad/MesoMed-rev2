import { resolveCountryGating } from "@mesomed/config";
import { ErrorCode } from "@mesomed/contracts/errors";
import type { ConfigService } from "./config.js";
import { AppError } from "./errors.js";

/**
 * Country gating guard (MM-PLAN-001 §3.9): public reads answer
 * COUNTRY_COMING_SOON for countries not enabled in the gating config row
 * (`directory.country_gating`, schema in packages/config). Flipping a
 * country is a config-data change; no module code lists countries. Lives in
 * the kernel because it is pure request-context policy shared by every
 * public-read module (directory, search, later feeds).
 */
export async function assertCountryActive(config: ConfigService, country: string): Promise<void> {
  const status = await resolveCountryGating(config, country);
  if (status !== "active") {
    throw new AppError(ErrorCode.COUNTRY_COMING_SOON, `Country ${country} is not yet available`);
  }
}
