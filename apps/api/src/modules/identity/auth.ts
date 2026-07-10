/**
 * Better Auth instance for the identity module (MM-DEC rev02, ADR-0004).
 *
 * Patients authenticate with phone + password: their user row carries a
 * placeholder email (never routable, never mailed) and phone ownership is
 * proven by OTP at signup/recovery — no OTP on routine login (§4).
 * Providers authenticate with email + password and must verify the email.
 *
 * The factory takes delivery callbacks instead of channels so the OTP
 * dispatch policy (rate limit, WhatsApp→SMS order) stays in the identity
 * module and concrete channels are wired in the composition root (§3.8).
 */
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { phoneNumber } from "better-auth/plugins/phone-number";
import { expo } from "@better-auth/expo";
import { isPlaceholderEmail, normalizePhone } from "@mesomed/domain/identity";
import type { Db } from "@mesomed/db";

export interface IdentityAuthOptions {
  db: Db;
  baseURL: string;
  secret: string;
  trustedOrigins: readonly string[];
  /** Deliver an OTP (identity OTP dispatch service). Throwing fails the endpoint. */
  sendOtp: (input: { phoneNumber: string; code: string }) => Promise<void>;
  /** Deliver a provider verification email. Never called for placeholder emails. */
  sendVerificationEmail: (input: { email: string; url: string }) => Promise<void>;
  /** Runs after phone ownership is proven — assigns role + claims profile in one tx. */
  onPhoneVerified: (input: { userId: string; phoneNumber: string }) => Promise<void>;
  otp?: IdentityOtpOptions;
}

export interface IdentityOtpOptions {
  expiresInSeconds?: number;
  allowedVerifyAttempts?: number;
}

export type IdentityAuth = ReturnType<typeof createIdentityAuth>;

export function createIdentityAuth(options: IdentityAuthOptions) {
  return betterAuth({
    baseURL: options.baseURL,
    basePath: "/api/auth",
    secret: options.secret,
    trustedOrigins: [...options.trustedOrigins],
    database: drizzleAdapter(options.db, { provider: "pg" }),
    session: {
      // Persistent sessions until logout/password change/revocation
      // (MM-DEC rev02 §4): 30-day rolling window, refreshed daily.
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    hooks: {
      // The phone-number plugin validates its own endpoints; signup carries
      // phoneNumber as an additional field, so the same normalization rule
      // is enforced here — profiles and auth identifiers stay keyed on
      // identical normalized values.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-up/email") return;
        const body = ctx.body as { phoneNumber?: unknown } | undefined;
        const phone = body?.phoneNumber;
        if (phone === undefined || phone === null) return;
        if (typeof phone !== "string" || normalizePhone(phone) !== phone) {
          throw new APIError("BAD_REQUEST", {
            message: "phoneNumber must be a normalized E.164 phone number",
            code: "VALIDATION",
          });
        }
      }),
    },
    emailAndPassword: {
      enabled: true,
      // Providers must verify their email before email+password sign-in
      // (MM-DEC rev02 §3). Patients sign in via phone and are unaffected;
      // their placeholder email is never verified, which also keeps the
      // placeholder path unusable for login.
      requireEmailVerification: true,
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      async sendVerificationEmail({ user, url }) {
        // Placeholder addresses are non-routable by construction; never mail them.
        if (isPlaceholderEmail(user.email)) return;
        await options.sendVerificationEmail({ email: user.email, url });
      },
    },
    plugins: [
      phoneNumber({
        otpLength: 6,
        expiresIn: options.otp?.expiresInSeconds ?? 300,
        allowedAttempts: options.otp?.allowedVerifyAttempts ?? 3,
        requireVerification: true,
        phoneNumberValidator: (phone) =>
          // Stored phones must already be normalized E.164 — the shared
          // domain rule keeps profile keys and auth identifiers identical.
          normalizePhone(phone) === phone,
        async sendOTP({ phoneNumber: phone, code }) {
          await options.sendOtp({ phoneNumber: phone, code });
        },
        async callbackOnVerification({ phoneNumber: phone, user }) {
          await options.onPhoneVerified({ userId: user.id, phoneNumber: phone });
        },
      }),
      expo(),
    ],
  });
}
