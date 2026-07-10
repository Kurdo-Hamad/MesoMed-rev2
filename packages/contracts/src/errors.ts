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
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
