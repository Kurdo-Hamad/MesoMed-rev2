/**
 * Auth client factory (MM-DEC rev02 §4/§7: persistent mobile sessions).
 * Storage is injected so tests exercise the real Better Auth Expo plugin
 * (cookie capture, persistence, sign-out clearing) with an in-memory
 * store; the app instance in `auth-client.ts` injects expo-secure-store.
 */
// The react entrypoint adds useSession for the account/auth screens; every
// plain method (signIn, getSession, signOut) is identical to better-auth/client,
// so the node-side persistence test keeps exercising the same code path.
import { createAuthClient } from "better-auth/react";
import { phoneNumberClient } from "better-auth/client/plugins";
import { expoClient } from "@better-auth/expo/client";

export interface AuthClientStorage {
  setItem: (key: string, value: string) => unknown;
  getItem: (key: string) => string | null;
}

export function createMobileAuthClient(options: { baseURL: string; storage: AuthClientStorage }) {
  return createAuthClient({
    baseURL: options.baseURL,
    plugins: [
      phoneNumberClient(),
      expoClient({
        scheme: "mesomed",
        storagePrefix: "mesomed",
        storage: options.storage,
      }),
    ],
  });
}

export type MobileAuthClient = ReturnType<typeof createMobileAuthClient>;
