/**
 * Provider password recovery by profile phone (MM-DEC rev02 §5, MM-QA-004
 * F-01). Providers sign in with email; their phone lives on the identity
 * provider profile, not the Better Auth user — so the §5 phone leg
 * (WhatsApp OTP → SMS after verified email) is this pair of public
 * commands rather than the phone-number plugin's user-phone reset.
 *
 * Security posture, mirroring the plugin's reset flow:
 *  - request never discloses whether the phone matched an account
 *    (identical response either way; nothing is sent for a miss).
 *  - the OTP is stored in Better Auth's verification store, short-lived
 *    (same expiry as sign-up OTPs) and SINGLE-ATTEMPT: the row is
 *    consumed before comparison, so a wrong guess burns the code and a
 *    replay finds nothing (stricter than the plugin's 3-attempt budget —
 *    a fresh code is one rate-limited request away).
 *  - delivery rides the identity OTP dispatch service: per-phone send
 *    limit, kernel abuse guards, WhatsApp→SMS order.
 *  - a successful reset updates the credential and revokes every session
 *    (§4: password change ends signed-in sessions).
 */
import { randomInt, timingSafeEqual } from "node:crypto";
import { APIError } from "better-auth/api";
import { ErrorCode } from "@mesomed/contracts/errors";
import { normalizePhone } from "@mesomed/domain/identity";
import { eq, providerProfiles, type Db } from "@mesomed/db";
import { AppError } from "../../../kernel/errors.js";
import type { IdentityAuth } from "../auth.js";
import { DEFAULT_OTP_EXPIRES_IN_SECONDS } from "../auth.js";
import type { OtpSendContext, OtpSender } from "../otp-sender.js";

const IDENTIFIER_PREFIX = "provider-recovery";

export interface ProviderPhoneRecoveryDeps {
  db: Db;
  auth: IdentityAuth;
  otpSender: OtpSender;
  /** Mirrors the plugin OTP expiry — see DEFAULT_OTP_EXPIRES_IN_SECONDS. */
  otpExpiresInSeconds?: number;
}

async function findRecoverableProvider(
  db: Db,
  normalizedPhone: string,
): Promise<{ userId: string } | undefined> {
  const [profile] = await db
    .select({ userId: providerProfiles.userId })
    .from(providerProfiles)
    .where(eq(providerProfiles.phone, normalizedPhone));
  return profile?.userId ? { userId: profile.userId } : undefined;
}

export async function requestProviderRecoveryOtp(
  deps: ProviderPhoneRecoveryDeps,
  input: { phone: string },
  context?: OtpSendContext,
): Promise<{ sent: boolean }> {
  const normalized = normalizePhone(input.phone);
  if (normalized === null) {
    throw new AppError(ErrorCode.VALIDATION, "Invalid phone number");
  }

  const provider = await findRecoverableProvider(deps.db, normalized);
  // No enumeration: a miss returns the same shape without sending.
  if (!provider) return { sent: true };

  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const expiresInSeconds = deps.otpExpiresInSeconds ?? DEFAULT_OTP_EXPIRES_IN_SECONDS;
  const authContext = await deps.auth.$context;
  const identifier = `${IDENTIFIER_PREFIX}:${normalized}`;
  // One live code per phone: replace any outstanding one.
  await authContext.internalAdapter.deleteVerificationByIdentifier(identifier);
  await authContext.internalAdapter.createVerificationValue({
    identifier,
    value: code,
    expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
  });
  try {
    await deps.otpSender.send({ phoneNumber: normalized, code }, context);
  } catch (error) {
    // The dispatch service throws Better Auth APIErrors (it normally runs
    // inside a Better Auth endpoint); translate to the typed AppError the
    // tRPC error formatter maps (convention #11).
    if (error instanceof APIError) {
      const appCode = (error.body as { code?: string } | undefined)?.code;
      throw new AppError(
        appCode === ErrorCode.RATE_LIMITED ? ErrorCode.RATE_LIMITED : ErrorCode.OTP_DELIVERY_FAILED,
        "Could not send the recovery code",
      );
    }
    throw error;
  }
  return { sent: true };
}

export async function resetProviderPasswordByOtp(
  deps: ProviderPhoneRecoveryDeps,
  input: { phone: string; code: string; newPassword: string },
): Promise<{ reset: boolean }> {
  const normalized = normalizePhone(input.phone);
  if (normalized === null) {
    throw new AppError(ErrorCode.VALIDATION, "Invalid phone number");
  }

  const authContext = await deps.auth.$context;
  const identifier = `${IDENTIFIER_PREFIX}:${normalized}`;
  const stored = await authContext.internalAdapter.findVerificationValue(identifier);
  // Single-attempt: consume (delete) before comparing, so a wrong guess
  // burns the code and concurrent replays find nothing.
  if (stored) await authContext.internalAdapter.deleteVerificationByIdentifier(identifier);

  const provider = await findRecoverableProvider(deps.db, normalized);
  const expired = stored != null && stored.expiresAt < new Date();
  const codeMatches =
    stored != null &&
    stored.value.length === input.code.length &&
    timingSafeEqual(Buffer.from(stored.value), Buffer.from(input.code));

  // One indistinguishable failure for wrong phone / no request / expired /
  // wrong code — nothing here may leak which it was.
  if (!provider || stored == null || expired || !codeMatches) {
    throw new AppError(ErrorCode.UNAUTHORIZED, "Invalid or expired recovery code");
  }

  const hashed = await authContext.password.hash(input.newPassword);
  await authContext.internalAdapter.updatePassword(provider.userId, hashed);
  await authContext.internalAdapter.deleteUserSessions(provider.userId);
  return { reset: true };
}
