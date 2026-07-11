import { z } from "zod";
import { PAYMENT_KINDS, type PaymentKind } from "@mesomed/contracts/billing";
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

// ── Payment gateway routing (MM-PLAN-001 §5 Phase 6) ────────────────────

/** `config_entries` key for the billing payment-routing value. */
export const PAYMENT_ROUTING_CONFIG_KEY = "billing.payment_routing";

/**
 * Payment routing (§3.9: country × payment kind → gateway id). The gateway
 * id is a free string validated at resolution time against the adapters
 * actually registered in the composition root — adding a gateway is a new
 * adapter plus a config edit, never a schema migration. A country or kind
 * absent from the map fails closed with a typed error at the call site.
 */
export const paymentRoutingSchema = z.record(
  z.string().regex(/^[A-Z]{2}$/, "ISO 3166-1 alpha-2, uppercase"),
  // Partial: a country may route only the kinds it has launched.
  z.partialRecord(z.enum(PAYMENT_KINDS), z.string().min(1)),
);

export type PaymentRouting = z.infer<typeof paymentRoutingSchema>;

/**
 * Resolve the configured gateway id for (country, kind), or null when the
 * config row is missing or has no entry — the caller maps null onto its
 * typed PAYMENT_GATEWAY_NOT_CONFIGURED error (§3.11). Other failures
 * propagate, as with country gating.
 */
export async function resolvePaymentGatewayId(
  config: ConfigReader,
  countryCode: string,
  kind: PaymentKind,
): Promise<string | null> {
  let routing: PaymentRouting;
  try {
    routing = await config.get(paymentRoutingSchema, PAYMENT_ROUTING_CONFIG_KEY);
  } catch (error) {
    if ((error as { code?: string }).code === "NOT_FOUND") return null;
    throw error;
  }
  return routing[countryCode.toUpperCase()]?.[kind] ?? null;
}
