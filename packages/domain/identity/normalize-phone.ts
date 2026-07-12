/**
 * Moved to @mesomed/contracts/phone (Phase 8): normalization is a wire
 * contract — the API rejects un-normalized phoneNumber payloads, so
 * clients must bundle the same rule. Re-exported here so server-side
 * call sites and the existing test suite keep their import path.
 */
export { normalizePhone } from "@mesomed/contracts/phone";
