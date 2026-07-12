/**
 * Mobile API compatibility gate (Phase 8, MM-ARC-002 §1.3): every tRPC
 * request carrying `x-app-version` is compared against the configured
 * minimum supported version (`mobile.compat` config row — convention #9);
 * below it, the request fails with the typed UPGRADE_REQUIRED before any
 * handler runs. Requests without the header (web, server-to-server) are
 * never gated. Absent config row = no minimum enforced.
 */
import { ErrorCode } from "@mesomed/contracts/errors";
import { resolveMobileCompat } from "@mesomed/config";
import type { Context } from "./context.js";
import { AppError } from "./errors.js";

export const APP_VERSION_HEADER = "x-app-version";

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

/**
 * Negative when a < b, positive when a > b, 0 when equal. Null when
 * either side is not "major.minor.patch" — a malformed client header is
 * treated as unknown, not blocked (fail open: the policy targets known
 * outdated clients, and blocking unknowns would gate curl/debug traffic).
 */
export function compareVersions(a: string, b: string): number | null {
  const left = VERSION_PATTERN.exec(a);
  const right = VERSION_PATTERN.exec(b);
  if (!left || !right) return null;
  for (let part = 1; part <= 3; part += 1) {
    const diff = Number(left[part]) - Number(right[part]);
    if (diff !== 0) return diff;
  }
  return 0;
}

export async function assertAppVersionSupported(ctx: Context): Promise<void> {
  const header = ctx.req.headers[APP_VERSION_HEADER];
  const version = Array.isArray(header) ? header[0] : header;
  if (version === undefined || version === "") return;

  const compat = await resolveMobileCompat(ctx.config);
  if (compat === null) return;

  const comparison = compareVersions(version, compat.minSupportedVersion);
  if (comparison !== null && comparison < 0) {
    throw new AppError(
      ErrorCode.UPGRADE_REQUIRED,
      `App version ${version} is below the minimum supported ${compat.minSupportedVersion}`,
    );
  }
}
