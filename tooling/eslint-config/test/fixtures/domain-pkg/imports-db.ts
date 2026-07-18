// VIOLATION (MM-PLAN-001 repo layout, MM-QA-004 F-09): pure domain logic
// must not reach the database.
import { createDb } from "@mesomed/db";

export const usesDb = createDb;
