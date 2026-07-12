/**
 * Moved to @mesomed/contracts/phone (Phase 8): clients construct the
 * placeholder email at signup (Better Auth requires an email field), so
 * the derivation is part of the wire contract. Re-exported here so
 * server-side call sites and the existing test suite keep their path.
 */
export { isPlaceholderEmail, placeholderEmailForPhone } from "@mesomed/contracts/phone";
