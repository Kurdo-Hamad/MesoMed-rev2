/**
 * The clinical module's table entrypoint (MM-QA-004 F-08): its own schema
 * plus the shared table-free core. Other modules must not import this file
 * — enforced by dbIsolationOverrides in @mesomed/eslint-config/api.
 */
export * from "../schema/clinical.js";
export * from "../core.js";
