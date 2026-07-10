/**
 * Identity module — OTP send rate limiting (pure window math).
 *
 * MM-DEC rev02 §8 requires OTP rate limiting to be real and tested in
 * Phase 2. The command layer records send timestamps per normalized phone;
 * this function decides whether another send is allowed.
 */

export interface OtpSendPolicy {
  /** Maximum sends allowed inside a rolling window. */
  maxSends: number;
  windowSeconds: number;
}

export type OtpSendVerdict = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export function evaluateOtpSendLimit(
  priorSends: readonly Date[],
  now: Date,
  policy: OtpSendPolicy,
): OtpSendVerdict {
  const windowMs = policy.windowSeconds * 1000;
  const cutoff = now.getTime() - windowMs;
  const inWindow = priorSends.filter((sent) => sent.getTime() > cutoff);

  if (inWindow.length < policy.maxSends) return { allowed: true };

  const oldest = Math.min(...inWindow.map((sent) => sent.getTime()));
  const retryAfterSeconds = Math.ceil((oldest + windowMs - now.getTime()) / 1000);
  return { allowed: false, retryAfterSeconds };
}
