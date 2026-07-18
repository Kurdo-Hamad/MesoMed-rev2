/**
 * Identity module assembly (MM-PLAN-001 §2, §5 Phase 2). The composition
 * root passes concrete channel adapters (mock in Phase 2, real in Phase 7)
 * and gets back the Better Auth instance and the kernel session resolver.
 */
import type { FastifyBaseLogger } from "fastify";
import { defaultLocale, locales } from "@mesomed/i18n";
import type { EmailChannel } from "@mesomed/platform";
import type { Db } from "@mesomed/db";
import type { Env } from "../../env.js";
import type { ConfigService } from "../../kernel/config.js";
import type { OutboxEmitter } from "../../kernel/outbox.js";
import type { SessionResolver } from "../../kernel/context.js";
import {
  createIdentityAuth,
  DEFAULT_OTP_EXPIRES_IN_SECONDS,
  type IdentityAuth,
  type IdentityOtpOptions,
} from "./auth.js";
import { createOnPhoneVerified } from "./commands/on-phone-verified.js";
import {
  assertRecoverySendAllowed,
  createOtpSender,
  recordRecoverySend,
  type OtpChannels,
  type OtpSender,
} from "./otp-sender.js";
import { createIdentitySessionResolver } from "./session-resolver.js";

/** Expo app scheme — must be trusted for the Better Auth Expo plugin. */
export const MOBILE_APP_SCHEME = "mesomed";

export interface IdentityModule {
  auth: IdentityAuth;
  sessionResolver: SessionResolver;
  /** The module's OTP dispatch service — the router's provider phone-recovery leg reuses it. */
  otpSender: OtpSender;
}

export function createIdentityModule(deps: {
  db: Db;
  config: ConfigService;
  outbox: OutboxEmitter;
  log: FastifyBaseLogger;
  env: Env;
  otpChannels: OtpChannels;
  emailChannel: EmailChannel;
  otpOptions?: IdentityOtpOptions;
}): IdentityModule {
  const otpSender = createOtpSender({
    db: deps.db,
    config: deps.config,
    channels: deps.otpChannels,
    log: deps.log,
    otpExpiresInSeconds: deps.otpOptions?.expiresInSeconds ?? DEFAULT_OTP_EXPIRES_IN_SECONDS,
  });
  const onPhoneVerified = createOnPhoneVerified({ db: deps.db, outbox: deps.outbox });

  const auth = createIdentityAuth({
    db: deps.db,
    baseURL: deps.env.BETTER_AUTH_URL,
    secret: deps.env.BETTER_AUTH_SECRET,
    trustedOrigins: [...deps.env.CORS_ORIGINS, `${MOBILE_APP_SCHEME}://`],
    sendOtp: (input, context) => otpSender.send(input, context),
    sendVerificationEmail: async ({ email, url }) => {
      const messages = locales[defaultLocale].identity.email;
      await deps.emailChannel.send({
        to: email,
        subject: messages.verifySubject,
        text: messages.verifyBody.replace("{url}", url),
      });
    },
    sendResetPasswordEmail: async ({ email, url }) => {
      // §5 email leg: same send-rate machinery as the OTP path, keyed on
      // the address (MM-QA-004 F-01; `email:` prefix disambiguates from
      // phone keys in the shared otp_send_attempts table).
      const now = new Date();
      const rateKey = `email:${email.toLowerCase()}`;
      await assertRecoverySendAllowed({ db: deps.db, config: deps.config }, rateKey, now);
      const messages = locales[defaultLocale].identity.email;
      await deps.emailChannel.send({
        to: email,
        subject: messages.resetSubject,
        text: messages.resetBody.replace("{url}", url),
      });
      await recordRecoverySend({ db: deps.db }, rateKey, now);
    },
    onPhoneVerified,
    otp: deps.otpOptions,
  });

  return {
    auth,
    sessionResolver: createIdentitySessionResolver({ auth, db: deps.db }),
    otpSender,
  };
}
