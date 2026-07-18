/**
 * Standalone Better Auth instance for `@better-auth/cli generate` only —
 * never imported at runtime. Regenerate the identity schema after a
 * better-auth upgrade with:
 *
 *   npx @better-auth/cli generate --config scripts/auth-cli-config.ts \
 *     --output /tmp/auth-schema.ts
 *
 * then reconcile the output with packages/db/src/schema/identity.ts.
 */
import { createDb } from "@mesomed/db";
import { createIdentityAuth } from "../src/modules/identity/auth.js";

const { db } = createDb("postgresql://cli:cli@localhost:5432/cli-schema-only");

export const auth = createIdentityAuth({
  db,
  baseURL: "http://localhost:4000",
  secret: "cli-schema-generation-secret-not-used-0000",
  trustedOrigins: [],
  sendOtp: () => Promise.resolve(),
  sendVerificationEmail: () => Promise.resolve(),
  sendResetPasswordEmail: () => Promise.resolve(),
  onPhoneVerified: () => Promise.resolve(),
});
