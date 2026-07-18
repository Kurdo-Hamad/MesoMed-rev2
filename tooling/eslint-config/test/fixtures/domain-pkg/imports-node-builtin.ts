// VIOLATION (MM-PLAN-001 repo layout, MM-QA-004 F-09): pure domain logic
// performs no I/O and uses no node builtins.
import { randomUUID } from "node:crypto";

export const usesNodeBuiltin = randomUUID;
