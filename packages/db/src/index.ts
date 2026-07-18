import journal from "../migrations/meta/_journal.json" with { type: "json" };

export * from "./schema/kernel.js";
export * from "./schema/identity.js";
export * from "./schema/directory.js";
export * from "./schema/search.js";
export * from "./schema/scheduling.js";
export * from "./schema/booking.js";
export * from "./schema/clinical.js";
export * from "./schema/billing.js";
export * from "./schema/communication.js";
// Client factory + query operators (moved to core.ts for the per-module
// entrypoints, MM-QA-004 F-08); the root surface is unchanged.
export * from "./core.js";

/** Where the drizzle migrator records applied migrations (pinned, not defaulted). */
export const MIGRATIONS_SCHEMA = "drizzle";
export const MIGRATIONS_TABLE = "__drizzle_migrations";

/**
 * The number of migrations this build of the code expects to be applied.
 * The journal is inlined at build time, so the API's readiness check can
 * compare it against the database without shipping the SQL files
 * (MM-QA-001 F-13).
 */
export const expectedMigrationCount: number = journal.entries.length;
