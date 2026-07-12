/**
 * OTP dispatch service (MM-DEC rev02 §8): rate limit per phone, then
 * WhatsApp-first with SMS fallback. Channel *transport* lives behind the
 * platform OtpChannel interface; the *policy* (order, limits) is identity
 * module logic and is fully exercised against the mock channels in Phase 2.
 */
import { z } from "zod";
import { APIError } from "better-auth/api";

import type { FastifyBaseLogger } from "fastify";
import { DEFAULT_LOCALE, type Locale } from "@mesomed/contracts/i18n";
import { ErrorCode } from "@mesomed/contracts/errors";
import { evaluateOtpSendLimit } from "@mesomed/domain/identity";
import { and, eq, gt, otpSendAttempts, type Db } from "@mesomed/db";
import type { OtpChannel } from "@mesomed/platform";
import type { ConfigService } from "../../kernel/config.js";
import { AppError } from "../../kernel/errors.js";
import {
  assertChannelEnabled,
  assertDestinationAllowed,
  assertSendRate,
  checkAndSpendBudget,
  recordVelocity,
} from "../../kernel/abuse.js";
import { recordNotificationSend } from "../../kernel/metrics.js";

export const OTP_SEND_POLICY_CONFIG_KEY = "identity.otpSendPolicy";

export const otpSendPolicySchema = z.object({
  maxSends: z.number().int().min(1),
  windowSeconds: z.number().int().min(1),
});

/** Applies when no `identity.otpSendPolicy` config row exists (§3.9). */
export const DEFAULT_OTP_SEND_POLICY = { maxSends: 5, windowSeconds: 3600 };

export interface OtpChannels {
  whatsapp: OtpChannel;
  sms: OtpChannel;
}

export interface OtpSendContext {
  /** Client IP, when the caller can supply one (per-IP rate scope). */
  ip?: string;
  /** Client-supplied device identifier (per-device rate scope). */
  deviceId?: string;
  /**
   * Best-effort locale, resolved from `Accept-Language` before any account
   * or preference row exists (ADR-0011 F-13). Falls back to the platform
   * default when absent or unrecognized.
   */
  locale?: Locale;
}

export interface OtpSender {
  send(input: { phoneNumber: string; code: string }, context?: OtpSendContext): Promise<void>;
}

/** Maps a guardrail's typed AppError onto the transport-level APIError this endpoint throws. */
function toApiError(error: AppError): APIError {
  switch (error.code) {
    case ErrorCode.RATE_LIMITED:
      return new APIError("TOO_MANY_REQUESTS", { message: error.message, code: error.code });
    case ErrorCode.CHANNEL_DISABLED:
    case ErrorCode.DESTINATION_NOT_ALLOWED:
      return new APIError("BAD_GATEWAY", {
        message: "Could not deliver the verification code",
        code: ErrorCode.OTP_DELIVERY_FAILED,
      });
    default:
      return new APIError("BAD_GATEWAY", {
        message: "Could not deliver the verification code",
        code: ErrorCode.OTP_DELIVERY_FAILED,
      });
  }
}

export function createOtpSender(deps: {
  db: Db;
  config: ConfigService;
  channels: OtpChannels;
  log: FastifyBaseLogger;
  /** Must mirror `IdentityOtpOptions.expiresInSeconds` — see ADR-0011 F-13. */
  otpExpiresInSeconds: number;
}): OtpSender {
  return {
    async send({ phoneNumber, code }, context = {}) {
      let policy = DEFAULT_OTP_SEND_POLICY;
      try {
        policy = await deps.config.get(otpSendPolicySchema, OTP_SEND_POLICY_CONFIG_KEY);
      } catch (error) {
        if (!(error instanceof AppError && error.code === ErrorCode.NOT_FOUND)) throw error;
      }

      const now = new Date();
      const cutoff = new Date(now.getTime() - policy.windowSeconds * 1000);
      const prior = await deps.db
        .select({ sentAt: otpSendAttempts.sentAt })
        .from(otpSendAttempts)
        .where(
          and(eq(otpSendAttempts.normalizedPhone, phoneNumber), gt(otpSendAttempts.sentAt, cutoff)),
        );

      const verdict = evaluateOtpSendLimit(
        prior.map((row) => row.sentAt),
        now,
        policy,
      );
      if (!verdict.allowed) {
        // Thrown inside Better Auth's send-otp endpoint, so it must be an
        // APIError to keep transport semantics (429); `code` carries the
        // app-level error code for clients (§3.11).
        throw new APIError("TOO_MANY_REQUESTS", {
          message: "OTP send limit reached for this phone number",
          code: ErrorCode.RATE_LIMITED,
          retryAfter: verdict.retryAfterSeconds,
        });
      }

      // Kernel abuse guardrails (MM-ARC-002 §6.6): destination allowlist and
      // per-IP/per-device rate limits apply before any channel is tried; a
      // channel-kill-switch check gates each transport individually below.
      try {
        await assertDestinationAllowed(deps.config, phoneNumber);
        if (context.ip) await assertSendRate(deps.db, deps.config, "ip", context.ip, now);
        if (context.deviceId) {
          await assertSendRate(deps.db, deps.config, "device", context.deviceId, now);
        }
      } catch (error) {
        if (error instanceof AppError) throw toApiError(error);
        throw error;
      }

      const message = {
        to: phoneNumber,
        code,
        locale: context.locale ?? DEFAULT_LOCALE,
        expiresInMinutes: Math.round(deps.otpExpiresInSeconds / 60),
      };
      let delivered: "whatsapp" | "sms";

      try {
        await assertChannelEnabled(deps.config, "whatsapp");
        await checkAndSpendBudget(deps.db, deps.config, "whatsapp", now);
        await deps.channels.whatsapp.send(message);
        delivered = "whatsapp";
      } catch (whatsappError) {
        deps.log.warn(
          { err: whatsappError, phoneNumber },
          "whatsapp OTP failed, falling back to sms",
        );
        try {
          await assertChannelEnabled(deps.config, "sms");
          await checkAndSpendBudget(deps.db, deps.config, "sms", now);
          await deps.channels.sms.send(message);
          delivered = "sms";
        } catch (smsError) {
          deps.log.error({ err: smsError, phoneNumber }, "sms OTP fallback failed");
          recordNotificationSend("whatsapp", "failed");
          recordNotificationSend("sms", "failed");
          if (smsError instanceof AppError) throw toApiError(smsError);
          throw new APIError("BAD_GATEWAY", {
            message: "Could not deliver the verification code",
            code: ErrorCode.OTP_DELIVERY_FAILED,
          });
        }
      }

      recordNotificationSend(delivered, "sent");
      await deps.db.insert(otpSendAttempts).values({ normalizedPhone: phoneNumber, sentAt: now });
      await recordVelocity(deps.db, deps.config, delivered, phoneNumber, now);
    },
  };
}
