import { TRPCError } from "@trpc/server";
import { ErrorCode } from "@mesomed/contracts/errors";

/**
 * Server-side error carrier for the typed error model (MM-PLAN-001 §3.11).
 * Lives in the kernel, not in contracts: only the server throws it, while
 * clients switch on the pure `ErrorCode` constants that stay in
 * `@mesomed/contracts/errors` (MM-QA-001 F-19, decided in ADR-0003).
 */
export class AppError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.code = code;
    this.name = "AppError";
  }
}

type TRPCErrorCode = TRPCError["code"];

/**
 * Application codes map onto transport codes so HTTP status semantics
 * survive. Without this mapping every AppError — including UNAUTHORIZED
 * and NOT_FOUND — surfaced as HTTP 500 (MM-QA-001 F-07).
 */
const APP_TO_TRPC = {
  [ErrorCode.INTERNAL]: "INTERNAL_SERVER_ERROR",
  [ErrorCode.UNAUTHORIZED]: "UNAUTHORIZED",
  [ErrorCode.FORBIDDEN]: "FORBIDDEN",
  [ErrorCode.NOT_FOUND]: "NOT_FOUND",
  [ErrorCode.VALIDATION]: "BAD_REQUEST",
  // Phase 2 (identity). Domain-specific codes keep their app identity in
  // `appCode` while mapping onto the closest transport semantics.
  [ErrorCode.CONFLICT]: "CONFLICT",
  [ErrorCode.RATE_LIMITED]: "TOO_MANY_REQUESTS",
  [ErrorCode.PROFILE_ALREADY_CLAIMED]: "CONFLICT",
  [ErrorCode.OTP_DELIVERY_FAILED]: "BAD_GATEWAY",
  [ErrorCode.INVALID_STATUS_TRANSITION]: "CONFLICT",
  [ErrorCode.PHONE_NOT_VERIFIED]: "PRECONDITION_FAILED",
  [ErrorCode.EMAIL_NOT_VERIFIED]: "PRECONDITION_FAILED",
  // Phase 3 (directory): a gated country is a stated precondition of the
  // request's x-mesomed-country, not a permissions problem.
  [ErrorCode.COUNTRY_COMING_SOON]: "PRECONDITION_FAILED",
  // Phase 4 (booking): a taken/blocked slot is a conflict with current
  // state — retryable by picking another slot.
  [ErrorCode.SLOT_UNAVAILABLE]: "CONFLICT",
  // Phase 5 (clinical): an unusable grant is an authorization failure; an
  // expired one is a stated precondition (re-grant and retry).
  [ErrorCode.SUPPORT_GRANT_INVALID]: "FORBIDDEN",
  [ErrorCode.SUPPORT_GRANT_EXPIRED]: "PRECONDITION_FAILED",
  // Phase 6 (billing): a missing routing entry / unconfigured adapter is a
  // stated precondition of the deployment; a gateway that did not settle a
  // settle-now payment is an upstream failure.
  [ErrorCode.PAYMENT_GATEWAY_NOT_CONFIGURED]: "PRECONDITION_FAILED",
  [ErrorCode.PAYMENT_NOT_SETTLED]: "BAD_GATEWAY",
  // Phase 6b (billing revenue model): a missing rate row / unselected
  // billing model is a stated precondition of the deployment's config.
  [ErrorCode.RATE_NOT_CONFIGURED]: "PRECONDITION_FAILED",
  [ErrorCode.BILLING_MODEL_NOT_CONFIGURED]: "PRECONDITION_FAILED",
  // Clinical extension (ADR-0010): mutating a superseded/discontinued
  // revision conflicts with the current revision-chain state — retryable
  // against the active revision.
  [ErrorCode.PRESCRIPTION_NOT_ACTIVE]: "CONFLICT",
} as const satisfies Record<ErrorCode, TRPCErrorCode>;

const TRPC_TO_APP: Partial<Record<TRPCErrorCode, ErrorCode>> = {
  BAD_REQUEST: ErrorCode.VALIDATION,
  UNAUTHORIZED: ErrorCode.UNAUTHORIZED,
  FORBIDDEN: ErrorCode.FORBIDDEN,
  NOT_FOUND: ErrorCode.NOT_FOUND,
  CONFLICT: ErrorCode.CONFLICT,
  TOO_MANY_REQUESTS: ErrorCode.RATE_LIMITED,
};

export function appErrorToTRPCError(error: AppError): TRPCError {
  return new TRPCError({
    code: APP_TO_TRPC[error.code],
    message: error.message,
    cause: error,
  });
}

/** The app-level code for a formatted tRPC error: an AppError cause wins,
 * otherwise the transport code maps back to its closest app code. */
export function toAppCode(error: { code: TRPCErrorCode; cause?: unknown }): ErrorCode {
  if (error.cause instanceof AppError) return error.cause.code;
  return TRPC_TO_APP[error.code] ?? ErrorCode.INTERNAL;
}
