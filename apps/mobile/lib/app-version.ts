import Constants from "expo-constants";

export const APP_VERSION_HEADER = "x-app-version";

/** The version every request identifies itself with (ADR-0013's mobile gate). */
export function getAppVersion(): string {
  return Constants.expoConfig?.version ?? "0.0.0";
}
