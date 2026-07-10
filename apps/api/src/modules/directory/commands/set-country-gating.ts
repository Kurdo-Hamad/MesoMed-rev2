/**
 * Admin country gating command (§3.9): reads the current gating config row
 * through the kernel config service, applies one country's status and
 * writes it back Zod-validated. The value is the single gating authority —
 * queries resolve it via `resolveCountryGating`; no code lists countries.
 */
import type { z } from "zod";
import type { setCountryGatingInputSchema } from "@mesomed/contracts/directory";
import {
  COUNTRY_GATING_CONFIG_KEY,
  countryGatingSchema,
  type CountryGating,
} from "@mesomed/config";
import type { ConfigService } from "../../../kernel/config.js";

export async function setCountryGating(
  config: ConfigService,
  input: z.output<typeof setCountryGatingInputSchema>,
): Promise<{ isoCode: string }> {
  let gating: CountryGating = {};
  try {
    gating = await config.get(countryGatingSchema, COUNTRY_GATING_CONFIG_KEY);
  } catch (error) {
    if ((error as { code?: string }).code !== "NOT_FOUND") throw error;
  }
  await config.set(countryGatingSchema, COUNTRY_GATING_CONFIG_KEY, {
    ...gating,
    [input.isoCode]: input.status,
  });
  return { isoCode: input.isoCode };
}
