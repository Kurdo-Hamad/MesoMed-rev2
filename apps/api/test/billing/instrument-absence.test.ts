import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "@mesomed/db";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";

/**
 * Phase 6b gate — instrument-absence meta-test (the HARD SECURITY RULE in
 * ADR-0009): billing tables store charge facts and opaque gateway
 * references ONLY. This suite introspects the real migrated schema and
 * fails if any billing column could hold payment-instrument data — by
 * name (card/PAN/CVV/IBAN/account-number vocabulary) or by shape
 * (free-form json/jsonb/bytea payloads capable of smuggling one).
 */
const BILLING_TABLES = [
  "subscriptions",
  "subscription_payments",
  "listing_tiers",
  "tier_prices",
  "facility_tiers",
  "tier_payments",
  "billing_charges",
  "billing_rate_config",
  "provider_billing_config",
  "provider_cancellation_policy",
  "billing_policy_evaluations",
] as const;

/**
 * Payment-instrument vocabulary. Deliberately word-bounded fragments:
 * `pan`, `cvv`, `iban` etc. must not match inside benign identifiers, but
 * `card_number`-style compounds must match anywhere.
 */
const INSTRUMENT_PATTERNS = [
  /(^|_)card(_|$)/, // card_number, cardholder_card…
  /(^|_)pan(_|$)/,
  /cvv|cvc|cvn/,
  /(^|_)iban(_|$)/,
  /(^|_)swift(_|$)/,
  /(^|_)bic(_|$)/,
  /account_(number|no)/,
  /routing_(number|no)/,
  /sort_code/,
  /card_?holder/,
  /(^|_)expiry_(month|year)/,
  /magstripe|track_data/,
  /(^|_)pin(_|$)/,
  /wallet_(address|number)/,
  /instrument/,
  /(^|_)token(_|$)/, // gateway tokens beyond the opaque ref are forbidden
];

/** Column types capable of holding arbitrary payloads. */
const FREEFORM_TYPES = new Set(["json", "jsonb", "bytea"]);

interface ColumnRow {
  table_name: string;
  column_name: string;
  data_type: string;
}

describe("billing schema stores no payment-instrument data", () => {
  let tdb: TestDatabase;
  let columns: ColumnRow[];

  beforeAll(async () => {
    tdb = await createTestDatabase();
    const result = await tdb.db.execute(sql`
      select table_name, column_name, data_type
      from information_schema.columns
      where table_schema = 'public'
        and table_name in (${sql.join(
          BILLING_TABLES.map((table) => sql`${table}`),
          sql`, `,
        )})
      order by table_name, ordinal_position
    `);
    columns = result.rows as unknown as ColumnRow[];
  }, 60_000);

  afterAll(async () => {
    await tdb.close();
  });

  it("introspects every billing table (the list itself is load-bearing)", () => {
    const found = new Set(columns.map((column) => column.table_name));
    for (const table of BILLING_TABLES) expect(found, table).toContain(table);
  });

  it("no billing column name matches instrument-data vocabulary", () => {
    const offenders = columns.filter((column) =>
      INSTRUMENT_PATTERNS.some((pattern) => pattern.test(column.column_name)),
    );
    expect(offenders.map((column) => `${column.table_name}.${column.column_name}`)).toEqual([]);
  });

  it("no billing column is a free-form payload type (json/jsonb/bytea)", () => {
    const offenders = columns.filter((column) => FREEFORM_TYPES.has(column.data_type));
    expect(
      offenders.map((column) => `${column.table_name}.${column.column_name}: ${column.data_type}`),
    ).toEqual([]);
  });

  it("gateway references stay opaque: only *_ref/reference text columns touch gateways", () => {
    const gatewayColumns = columns.filter(
      (column) => column.column_name.includes("gateway") || column.column_name === "reference",
    );
    for (const column of gatewayColumns) {
      expect(column.data_type).toBe("text");
    }
  });
});
