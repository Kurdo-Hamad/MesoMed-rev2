import { z } from "zod";
import { PAYMENT_KINDS, type PaymentKind } from "@mesomed/contracts/billing";
import {
  CATEGORY_GATING_STATUSES,
  COUNTRY_GATING_STATUSES,
  DOCTORS_TILE_ID,
  type CategoryGatingStatus,
  type CountryGatingStatus,
} from "@mesomed/contracts/directory";
import { NOTIFICATION_CHANNELS, type NotificationChannel } from "@mesomed/contracts/communication";

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

// ── Category gating & per-country display (ADR-0055) ───────────────────

/** `config_entries` key for the directory category gating value. */
export const CATEGORY_GATING_CONFIG_KEY = "directory.category_gating";

export { CATEGORY_GATING_STATUSES, type CategoryGatingStatus };

/**
 * Category gating (ADR-0055): category slug → status. Unlike country
 * gating this fails OPEN — a category absent from the map is `active`.
 * The row exists only to mark the explicitly deferred categories as
 * `coming_soon` (deferred-visible tiles), never to require listing every
 * built one; losing the row must not hide the catalog.
 */
export const categoryGatingSchema = z.record(
  z.string().regex(/^[a-z][a-z0-9_]*$/, "lowercase snake_case category slug"),
  z.enum(CATEGORY_GATING_STATUSES),
);

export type CategoryGating = z.infer<typeof categoryGatingSchema>;

/**
 * Read the whole gating map; a missing config entry resolves to an empty
 * map (fail open — every category `active`). Any other failure
 * (connectivity, schema violation) propagates, as with country gating.
 */
export async function readCategoryGating(config: ConfigReader): Promise<CategoryGating> {
  try {
    return await config.get(categoryGatingSchema, CATEGORY_GATING_CONFIG_KEY);
  } catch (error) {
    if ((error as { code?: string }).code === "NOT_FOUND") return {};
    throw error;
  }
}

/** Resolve one category's status; an unlisted category is `active`. */
export async function resolveCategoryGating(
  config: ConfigReader,
  slug: string,
): Promise<CategoryGatingStatus> {
  return (await readCategoryGating(config))[slug] ?? "active";
}

/** `config_entries` key for the per-country homepage tile lists. */
export const CATEGORY_DISPLAY_CONFIG_KEY = "directory.category_display";

export { DOCTORS_TILE_ID };

/**
 * Per-country homepage tile lists (ADR-0055): ISO 3166-1 alpha-2 code →
 * ordered tile ids (category slugs plus the reserved `doctors` tile,
 * which the slug pattern already admits). A country absent from the map
 * shows the full active category list — IQ is deliberately unlisted.
 */
export const categoryDisplaySchema = z.record(
  z.string().regex(/^[A-Z]{2}$/, "ISO 3166-1 alpha-2, uppercase"),
  z.array(z.string().regex(/^[a-z][a-z0-9_]*$/, "tile id")).min(1),
);

export type CategoryDisplay = z.infer<typeof categoryDisplaySchema>;

/**
 * Resolve a country's configured tile list, or null when the config row
 * is missing or the country is unlisted — the caller falls back to the
 * full active category list. Other failures propagate, as with country
 * gating.
 */
export async function resolveCategoryDisplay(
  config: ConfigReader,
  countryIso: string,
): Promise<string[] | null> {
  let display: CategoryDisplay;
  try {
    display = await config.get(categoryDisplaySchema, CATEGORY_DISPLAY_CONFIG_KEY);
  } catch (error) {
    if ((error as { code?: string }).code === "NOT_FOUND") return null;
    throw error;
  }
  return display[countryIso.toUpperCase()] ?? null;
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

// ── Communication abuse controls (MM-PLAN-001 §5 Phase 7, MM-ARC-002 §6.6) ──

/** `config_entries` key for the global per-channel kill-switch. */
export const CHANNEL_KILL_SWITCH_CONFIG_KEY = "communication.channel_kill_switch";

/**
 * Global per-channel kill-switch: channel → killed. Flipping a channel is
 * a config-row edit that takes effect within the config-cache TTL — no
 * deploy (§3.9). A missing row or missing entry means the channel is
 * enabled; `true` refuses every send on that channel.
 */
export const channelKillSwitchSchema = z.partialRecord(z.enum(NOTIFICATION_CHANNELS), z.boolean());

export type ChannelKillSwitch = z.infer<typeof channelKillSwitchSchema>;

export async function resolveChannelKilled(
  config: ConfigReader,
  channel: NotificationChannel,
): Promise<boolean> {
  let killSwitch: ChannelKillSwitch;
  try {
    killSwitch = await config.get(channelKillSwitchSchema, CHANNEL_KILL_SWITCH_CONFIG_KEY);
  } catch (error) {
    if ((error as { code?: string }).code === "NOT_FOUND") return false;
    throw error;
  }
  return killSwitch[channel] ?? false;
}

/** `config_entries` key for the destination-country allowlist. */
export const DESTINATION_COUNTRIES_CONFIG_KEY = "communication.destination_countries";

/**
 * Destination-country allowlist: ISO country → E.164 calling prefixes.
 * Phone-channel sends are permitted only to numbers matching a prefix of
 * an allowlisted country. Fail closed: a missing row or an unmatched
 * prefix denies the send. Iraq-only at launch; adding a country is a
 * config edit, never a code change (§3.9).
 */
export const destinationCountriesSchema = z.record(
  z.string().regex(/^[A-Z]{2}$/, "ISO 3166-1 alpha-2, uppercase"),
  z.object({ prefixes: z.array(z.string().regex(/^\+\d{1,4}$/)).min(1) }),
);

export type DestinationCountries = z.infer<typeof destinationCountriesSchema>;

/** The launch allowlist seed (MM-ARC-002 §6.6: Iraq-only). */
export const DEFAULT_DESTINATION_COUNTRIES: DestinationCountries = {
  IQ: { prefixes: ["+964"] },
};

/**
 * The allowlisted country an E.164 destination belongs to, or null when
 * no allowlisted prefix matches (deny). A missing config row falls back to
 * the launch seed rather than failing open.
 */
export async function resolveDestinationCountry(
  config: ConfigReader,
  phone: string,
): Promise<string | null> {
  let countries: DestinationCountries;
  try {
    countries = await config.get(destinationCountriesSchema, DESTINATION_COUNTRIES_CONFIG_KEY);
  } catch (error) {
    if ((error as { code?: string }).code === "NOT_FOUND") {
      countries = DEFAULT_DESTINATION_COUNTRIES;
    } else {
      throw error;
    }
  }
  for (const [country, { prefixes }] of Object.entries(countries)) {
    if (prefixes.some((prefix) => phone.startsWith(prefix))) return country;
  }
  return null;
}

/** `config_entries` key for per-channel daily spend budgets. */
export const CHANNEL_BUDGETS_CONFIG_KEY = "communication.channel_budgets";

/**
 * Daily spend budget per channel, counted in sends: at `alarmAt` an alert
 * row is written; at `dailyLimit` further sends are refused (plus an
 * alert). A channel without an entry is unbudgeted — budgets are an
 * operational choice, but the enforcement path is always wired.
 */
export const channelBudgetsSchema = z.partialRecord(
  z.enum(NOTIFICATION_CHANNELS),
  z.object({
    dailyLimit: z.number().int().min(0),
    alarmAt: z.number().int().min(0),
  }),
);

export type ChannelBudgets = z.infer<typeof channelBudgetsSchema>;

export async function resolveChannelBudget(
  config: ConfigReader,
  channel: NotificationChannel,
): Promise<{ dailyLimit: number; alarmAt: number } | null> {
  let budgets: ChannelBudgets;
  try {
    budgets = await config.get(channelBudgetsSchema, CHANNEL_BUDGETS_CONFIG_KEY);
  } catch (error) {
    if ((error as { code?: string }).code === "NOT_FOUND") return null;
    throw error;
  }
  return budgets[channel] ?? null;
}

/** Scopes a send-rate limit can key on (MM-ARC-002 §6.6). */
export const SEND_RATE_SCOPES = ["phone", "ip", "device"] as const;

export type SendRateScope = (typeof SEND_RATE_SCOPES)[number];

/** `config_entries` key for the per-scope send-rate policy. */
export const SEND_RATE_POLICY_CONFIG_KEY = "communication.send_rate_policy";

export const sendRatePolicySchema = z.partialRecord(
  z.enum(SEND_RATE_SCOPES),
  z.object({
    maxSends: z.number().int().min(1),
    windowSeconds: z.number().int().min(1),
  }),
);

export type SendRatePolicy = z.infer<typeof sendRatePolicySchema>;

/**
 * Applies when no config row exists: the abuse guardrails are on by
 * default — a deployment can loosen them by config, never by omission.
 */
export const DEFAULT_SEND_RATE_POLICY: Required<SendRatePolicy> = {
  phone: { maxSends: 30, windowSeconds: 3600 },
  ip: { maxSends: 15, windowSeconds: 3600 },
  device: { maxSends: 15, windowSeconds: 3600 },
};

export async function resolveSendRatePolicy(
  config: ConfigReader,
  scope: SendRateScope,
): Promise<{ maxSends: number; windowSeconds: number }> {
  let policy: SendRatePolicy;
  try {
    policy = await config.get(sendRatePolicySchema, SEND_RATE_POLICY_CONFIG_KEY);
  } catch (error) {
    if ((error as { code?: string }).code === "NOT_FOUND") return DEFAULT_SEND_RATE_POLICY[scope];
    throw error;
  }
  return policy[scope] ?? DEFAULT_SEND_RATE_POLICY[scope];
}

/** `config_entries` key for the velocity anomaly-detection policy. */
export const VELOCITY_POLICY_CONFIG_KEY = "communication.velocity_policy";

/**
 * Velocity anomaly detection (MM-ARC-002 §6.6): more than `threshold`
 * sends to one destination key on one channel within the window writes an
 * alert row. Detection only — it never blocks; blocking is the rate
 * limits' and budgets' job.
 */
export const velocityPolicySchema = z.object({
  threshold: z.number().int().min(1),
  windowSeconds: z.number().int().min(1),
});

export type VelocityPolicy = z.infer<typeof velocityPolicySchema>;

export const DEFAULT_VELOCITY_POLICY: VelocityPolicy = { threshold: 20, windowSeconds: 600 };

export async function resolveVelocityPolicy(config: ConfigReader): Promise<VelocityPolicy> {
  try {
    return await config.get(velocityPolicySchema, VELOCITY_POLICY_CONFIG_KEY);
  } catch (error) {
    if ((error as { code?: string }).code === "NOT_FOUND") return DEFAULT_VELOCITY_POLICY;
    throw error;
  }
}

// ── AI triage quotas (MM-PLAN-001 §5 Phase 7, MM-ARC-002 §6.7) ──────────

/** `config_entries` key for the AI triage rate policy. */
export const AI_TRIAGE_RATE_POLICY_CONFIG_KEY = "ai.triage_rate_policy";

const tokenBucketSchema = z.object({
  capacity: z.number().min(1),
  refillPerSecond: z.number().positive(),
});

/**
 * Two independent quotas on the triage procedure (§6.7): `perCaller`
 * throttles one user/IP; `global` caps the whole deployment's model spend.
 * Both are enforced separately and both fail with distinct typed errors.
 */
export const aiTriageRatePolicySchema = z.object({
  perCaller: tokenBucketSchema,
  global: tokenBucketSchema,
});

export type AiTriageRatePolicy = z.infer<typeof aiTriageRatePolicySchema>;

export const DEFAULT_AI_TRIAGE_RATE_POLICY: AiTriageRatePolicy = {
  perCaller: { capacity: 10, refillPerSecond: 0.1 },
  global: { capacity: 120, refillPerSecond: 2 },
};

export async function resolveAiTriageRatePolicy(config: ConfigReader): Promise<AiTriageRatePolicy> {
  try {
    return await config.get(aiTriageRatePolicySchema, AI_TRIAGE_RATE_POLICY_CONFIG_KEY);
  } catch (error) {
    if ((error as { code?: string }).code === "NOT_FOUND") return DEFAULT_AI_TRIAGE_RATE_POLICY;
    throw error;
  }
}

// ── Mobile API compatibility (Phase 8, MM-ARC-002 §1.3) ─────────────────

export const MOBILE_COMPAT_CONFIG_KEY = "mobile.compat";

/**
 * Minimum supported mobile client version per convention #9 — a config
 * row, not code. The kernel middleware compares the client's
 * `x-app-version` against `minSupportedVersion` and answers the typed
 * UPGRADE_REQUIRED below it. Absent config row = no minimum enforced
 * (web clients send no version header and are never gated).
 */
export const mobileCompatSchema = z.object({
  /** Semantic version "major.minor.patch". */
  minSupportedVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
});

export type MobileCompat = z.infer<typeof mobileCompatSchema>;

export async function resolveMobileCompat(config: ConfigReader): Promise<MobileCompat | null> {
  try {
    return await config.get(mobileCompatSchema, MOBILE_COMPAT_CONFIG_KEY);
  } catch (error) {
    if ((error as { code?: string }).code === "NOT_FOUND") return null;
    throw error;
  }
}
