import { z } from "zod";
import { COUNTRY_GATING_STATUSES, type CountryGatingStatus } from "@mesomed/contracts/directory";

/**
 * Config-over-code schemas (MM-PLAN-001 §3.9): configuration lives in
 * config tables; every consumer validates reads with the Zod schema owned
 * here. The DB-backed store is the Phase 1 kernel config service
 * (`config_entries` + Zod-validated loader) — this package deliberately
 * depends on nothing but Zod so web/mobile/admin tooling can share it.
 */

/** `config_entries` key for the directory country gating value. */
export const COUNTRY_GATING_CONFIG_KEY = "directory.country_gating";

export { COUNTRY_GATING_STATUSES, type CountryGatingStatus };

/**
 * Country gating (MM-PLAN-001 §5 Phase 3): ISO 3166-1 alpha-2 code →
 * status. Adding or flipping a country is an edit to this one config row —
 * zero code changes in any module (§3.9); a country absent from the map is
 * treated as `coming_soon` (fail closed).
 */
export const countryGatingSchema = z.record(
  z.string().regex(/^[A-Z]{2}$/, "ISO 3166-1 alpha-2, uppercase"),
  z.enum(COUNTRY_GATING_STATUSES),
);

export type CountryGating = z.infer<typeof countryGatingSchema>;

/** A config reader shaped like the kernel config service's `get`. */
export interface ConfigReader {
  get<Schema extends z.ZodType>(schema: Schema, key: string): Promise<z.output<Schema>>;
}

/**
 * Resolve the gating status for a country code. A missing config entry or
 * an unlisted country resolves to `coming_soon` — the directory never
 * serves a country nobody has explicitly enabled. Any other failure
 * (connectivity, schema violation) propagates: an outage must not silently
 * present the platform as "coming soon".
 */
export async function resolveCountryGating(
  config: ConfigReader,
  countryCode: string,
): Promise<CountryGatingStatus> {
  let gating: CountryGating;
  try {
    gating = await config.get(countryGatingSchema, COUNTRY_GATING_CONFIG_KEY);
  } catch (error) {
    if ((error as { code?: string }).code === "NOT_FOUND") return "coming_soon";
    throw error;
  }
  return gating[countryCode.toUpperCase()] ?? "coming_soon";
}
