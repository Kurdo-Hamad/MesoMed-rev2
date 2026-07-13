import Constants from "expo-constants";

const MEDIA_URL =
  (Constants.expoConfig?.extra?.mediaUrl as string | undefined) ?? "http://localhost:4000";

/**
 * Facility/doctor media paths are stored host-relative; the media origin is
 * deployment config. Absolute URLs (doctor photoUrl may be one) pass
 * through. Mirrors apps/web/lib/media.ts.
 */
export function mediaUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${MEDIA_URL}${path.startsWith("/") ? "" : "/"}${path}`;
}
