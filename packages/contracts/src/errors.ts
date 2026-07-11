/**
 * Typed error codes per MM-PLAN-001 §3.11 — clients switch on `code`, never
 * parse messages. This module is pure data shared with web/mobile clients;
 * the server-side `AppError` class that carries these codes lives in the
 * API kernel (`apps/api/src/kernel/errors.ts`), because only the server
 * throws it (MM-QA-001 F-19, resolved in ADR-0003).
 */
export const ErrorCode = {
  INTERNAL: "INTERNAL",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  VALIDATION: "VALIDATION",
  // Phase 2 (identity) — additive only.
  CONFLICT: "CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",
  PROFILE_ALREADY_CLAIMED: "PROFILE_ALREADY_CLAIMED",
  OTP_DELIVERY_FAILED: "OTP_DELIVERY_FAILED",
  INVALID_STATUS_TRANSITION: "INVALID_STATUS_TRANSITION",
  PHONE_NOT_VERIFIED: "PHONE_NOT_VERIFIED",
  EMAIL_NOT_VERIFIED: "EMAIL_NOT_VERIFIED",
  // Phase 3 (directory) — additive only.
  COUNTRY_COMING_SOON: "COUNTRY_COMING_SOON",
  // Phase 4 (scheduling/booking) — additive only.
  SLOT_UNAVAILABLE: "SLOT_UNAVAILABLE",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
