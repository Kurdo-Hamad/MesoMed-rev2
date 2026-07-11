import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";
import { createMobileAuthClient } from "./create-auth-client.js";

const baseURL =
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ?? "http://localhost:4000";

/** App-wide Better Auth client: session tokens persist in the device keychain. */
export const authClient = createMobileAuthClient({ baseURL, storage: SecureStore });
