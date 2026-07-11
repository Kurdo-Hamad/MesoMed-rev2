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

// ── Known payment gateways (MM-PLAN-001 §5 Phase 6b) ────────────────────

/** `config_entries` key for the config-driven gateway-id registry. */
export const KNOWN_GATEWAYS_CONFIG_KEY = "billing.known_gateways";

/**
 * Gateway ids routable before their adapters ship. `manual` is complete;
 * `fib`, `zaincash` and `stripe` are interface-ready ids staged ahead of
 * their adapters (§8 deferral) — routing to one of them fails closed until
 * a real adapter is wired in the composition root.
 */
export const DEFAULT_KNOWN_GATEWAY_IDS = ["manual", "fib", "zaincash", "stripe"] as const;

export const knownGatewaysSchema = z.array(
  z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z][a-z0-9_]*$/),
);

export type KnownGateways = z.infer<typeof knownGatewaysSchema>;

/**
 * The full set of routable gateway ids: the launch defaults plus any ids
 * registered via the config row. Adding a gateway is an adapter in
 * `packages/platform` plus config rows — NEVER a schema migration or a
 * code change here (§3.9); resolution stays fail-closed until the adapter
 * is really wired.
 */
export async function resolveKnownGatewayIds(config: ConfigReader): Promise<readonly string[]> {
  let registered: KnownGateways;
  try {
    registered = await config.get(knownGatewaysSchema, KNOWN_GATEWAYS_CONFIG_KEY);
  } catch (error) {
    if ((error as { code?: string }).code === "NOT_FOUND") return DEFAULT_KNOWN_GATEWAY_IDS;
    throw error;
  }
  return [...new Set([...DEFAULT_KNOWN_GATEWAY_IDS, ...registered])];
}

// ── Billing trial default (MM-PLAN-001 §5 Phase 6b) ─────────────────────

/** `config_entries` key for the global free-trial default. */
export const BILLING_TRIAL_CONFIG_KEY = "billing.trial";

/**
 * Global trial default: subscription-fee accrual is waived for this many
 * calendar months from the provider's billing-config creation, unless the
 * provider carries a `trial_ends_at` override. Per-booking charges are
 * NEVER affected by trial. 0 (or a missing row) = no global trial.
 */
export const billingTrialSchema = z.object({
  defaultMonths: z.number().int().min(0).max(24),
});

export type BillingTrial = z.infer<typeof billingTrialSchema>;

export async function resolveTrialDefaultMonths(config: ConfigReader): Promise<number> {
  try {
    return (await config.get(billingTrialSchema, BILLING_TRIAL_CONFIG_KEY)).defaultMonths;
  } catch (error) {
    if ((error as { code?: string }).code === "NOT_FOUND") return 0;
    throw error;
  }
}

// ── Patient-collection master switch (MM-PLAN-001 §5 Phase 6b) ──────────

/** `config_entries` key for the global patient-collection flag. */
export const PATIENT_COLLECTION_CONFIG_KEY = "billing.patient_collection_enabled";

export const patientCollectionSchema = z.object({ enabled: z.boolean() });

/**
 * The single global gate on collecting cancellation/no-show charges from
 * patients. Policy evaluation always runs and records its outcome; while
 * this resolves false (including a missing row — fail closed, the launch
 * state) handlers record nothing collectable, settle nothing, and never
 * touch a gateway. Flipping the flag activates the already-wired path —
 * a config edit, zero code change.
 */
export async function resolvePatientCollectionEnabled(config: ConfigReader): Promise<boolean> {
  try {
    return (await config.get(patientCollectionSchema, PATIENT_COLLECTION_CONFIG_KEY)).enabled;
  } catch (error) {
    if ((error as { code?: string }).code === "NOT_FOUND") return false;
    throw error;
  }
}
