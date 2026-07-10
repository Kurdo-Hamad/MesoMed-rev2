/**
 * OTP dispatch service (MM-DEC rev02 §8): rate limit per phone, then
 * WhatsApp-first with SMS fallback. Channel *transport* lives behind the
 * platform OtpChannel interface; the *policy* (order, limits) is identity
 * module logic and is fully exercised against the mock channels in Phase 2.
 */
import { z } from "zod";
import { APIError } from "better-auth/api";

import type { FastifyBaseLogger } from "fastify";
import { DEFAULT_LOCALE } from "@mesomed/contracts/i18n";
import { ErrorCode } from "@mesomed/contracts/errors";
import { evaluateOtpSendLimit } from "@mesomed/domain/identity";
import { and, eq, gt, otpSendAttempts, type Db } from "@mesomed/db";
import type { OtpChannel } from "@mesomed/platform";
import type { ConfigService } from "../../kernel/config.js";
import { AppError } from "../../kernel/errors.js";

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

export interface OtpSender {
  send(input: { phoneNumber: string; code: string }): Promise<void>;
}

export function createOtpSender(deps: {
  db: Db;
  config: ConfigService;
  channels: OtpChannels;
  log: FastifyBaseLogger;
}): OtpSender {
  return {
    async send({ phoneNumber, code }) {
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

      const message = { to: phoneNumber, code, locale: DEFAULT_LOCALE };
      try {
        await deps.channels.whatsapp.send(message);
      } catch (whatsappError) {
        deps.log.warn({ err: whatsappError, phoneNumber }, "whatsapp OTP failed, falling back to sms");
        try {
          await deps.channels.sms.send(message);
        } catch (smsError) {
          deps.log.error({ err: smsError, phoneNumber }, "sms OTP fallback failed");
          throw new APIError("BAD_GATEWAY", {
            message: "Could not deliver the verification code",
            code: ErrorCode.OTP_DELIVERY_FAILED,
          });
        }
      }

      await deps.db.insert(otpSendAttempts).values({ normalizedPhone: phoneNumber, sentAt: now });
    },
  };
}
