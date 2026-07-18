/**
 * Table-free shared surface of @mesomed/db: the client factory/types plus
 * query operators. Module code (apps/api/src/modules/*) reaches tables only
 * through its own `@mesomed/db/modules/<name>` entrypoint (MM-QA-004 F-08,
 * MM-PLAN-001 §3.1); everything here is safe to import from any module.
 */
export * from "./client.js";

// Query operators re-exported from the drizzle-orm build this package's
// tables are typed with. Module code must import them from here — mixing a
// second drizzle-orm instance (e.g. hoisted differently by a dependency)
// produces incompatible column types at compile time.
export { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
export type { SQL } from "drizzle-orm";
