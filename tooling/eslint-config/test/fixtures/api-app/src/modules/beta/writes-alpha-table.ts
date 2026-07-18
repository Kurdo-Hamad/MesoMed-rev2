// VIOLATION (MM-PLAN-001 §3.1, MM-QA-004 F-08): a module importing another
// module's tables via that module's @mesomed/db entrypoint.
// The specifier need not resolve — the guardrail is path-pattern based.
import { alphaTable } from "@mesomed/db/modules/alpha";

export const betaWritesAlpha = alphaTable;
