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
import { createIdentityAuth, type IdentityAuth } from "./auth.js";
import { createOnPhoneVerified } from "./commands/on-phone-verified.js";
import { createOtpSender, type OtpChannels } from "./otp-sender.js";
import { createIdentitySessionResolver } from "./session-resolver.js";

/** Expo app scheme — must be trusted for the Better Auth Expo plugin. */
export const MOBILE_APP_SCHEME = "mesomed";

export interface IdentityModule {
  auth: IdentityAuth;
  sessionResolver: SessionResolver;
}

export function createIdentityModule(deps: {
  db: Db;
  config: ConfigService;
  outbox: OutboxEmitter;
  log: FastifyBaseLogger;
  env: Env;
  otpChannels: OtpChannels;
  emailChannel: EmailChannel;
}): IdentityModule {
  const otpSender = createOtpSender({
    db: deps.db,
    config: deps.config,
    channels: deps.otpChannels,
    log: deps.log,
  });
  const onPhoneVerified = createOnPhoneVerified({ db: deps.db, outbox: deps.outbox });

  const auth = createIdentityAuth({
    db: deps.db,
    baseURL: deps.env.BETTER_AUTH_URL,
    secret: deps.env.BETTER_AUTH_SECRET,
    trustedOrigins: [...deps.env.CORS_ORIGINS, `${MOBILE_APP_SCHEME}://`],
    sendOtp: (input) => otpSender.send(input),
    sendVerificationEmail: async ({ email, url }) => {
      const messages = locales[defaultLocale].identity.email;
      await deps.emailChannel.send({
        to: email,
        subject: messages.verifySubject,
        text: messages.verifyBody.replace("{url}", url),
      });
    },
    onPhoneVerified,
  });

  return {
    auth,
    sessionResolver: createIdentitySessionResolver({ auth, db: deps.db }),
  };
}
