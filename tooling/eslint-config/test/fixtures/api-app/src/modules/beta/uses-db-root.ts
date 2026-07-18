// VIOLATION (MM-QA-004 F-08): a module importing the @mesomed/db root hub,
// which re-exports EVERY module's tables — bypasses table-level isolation.
import { eq } from "@mesomed/db";

export const betaUsesRoot = eq;
