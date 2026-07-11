import journal from "../migrations/meta/_journal.json" with { type: "json" };

export * from "./schema/kernel.js";
export * from "./schema/identity.js";
export * from "./schema/directory.js";
export * from "./schema/search.js";
export * from "./schema/scheduling.js";
export * from "./schema/booking.js";
export * from "./client.js";

// Query operators re-exported from the drizzle-orm build this package's
// tables are typed with. Module code must import them from here — mixing a
// second drizzle-orm instance (e.g. hoisted differently by a dependency)
// produces incompatible column types at compile time.
export { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
export type { SQL } from "drizzle-orm";

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
