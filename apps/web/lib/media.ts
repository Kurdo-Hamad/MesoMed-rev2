const MEDIA_URL = process.env.NEXT_PUBLIC_MEDIA_URL ?? "http://localhost:4000";

/**
 * Facility/doctor media paths are stored host-relative; the media origin is
 * deployment config (next.config.ts allowlists the same host for
 * next/image). Absolute URLs (doctor photoUrl may be one) pass through.
 */
export function mediaUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${MEDIA_URL}${path.startsWith("/") ? "" : "/"}${path}`;
}
