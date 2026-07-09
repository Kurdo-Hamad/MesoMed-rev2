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
} as const satisfies Record<ErrorCode, TRPCErrorCode>;

const TRPC_TO_APP: Partial<Record<TRPCErrorCode, ErrorCode>> = {
  BAD_REQUEST: ErrorCode.VALIDATION,
  UNAUTHORIZED: ErrorCode.UNAUTHORIZED,
  FORBIDDEN: ErrorCode.FORBIDDEN,
  NOT_FOUND: ErrorCode.NOT_FOUND,
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
