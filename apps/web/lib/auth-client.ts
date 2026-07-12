import { createAuthClient } from "better-auth/react";
import { phoneNumberClient } from "better-auth/client/plugins";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/**
 * Better Auth client against the API's /api/auth/* surface (identity
 * module, MM-DEC rev02): patients sign in with phone+password (the
 * phone-number plugin), providers with email+password. Session cookies are
 * cross-origin — the API's CORS allowlist carries credentials.
 */
export const authClient = createAuthClient({
  baseURL: API_URL,
  plugins: [phoneNumberClient()],
  fetchOptions: { credentials: "include" },
});
