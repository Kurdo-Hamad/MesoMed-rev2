/**
 * Identity module — phone number normalization (pure).
 *
 * Patient profiles are keyed on the normalized (E.164) phone number
 * (MM-DEC rev02 §1/§9). Iraq is the default region: local mobile numbers
 * (07XXXXXXXXX) normalize to +9647XXXXXXXXX. Numbers already in E.164
 * (any country) pass through after validation.
 */

const IQ_COUNTRY_CODE = "964";

/** Local Iraqi mobile: 07 followed by 9 digits (11 digits total). */
const IQ_LOCAL_MOBILE = /^07\d{9}$/;

/** E.164: + then a non-zero digit and 7–14 more digits (max 15 digits). */
const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * Normalize a raw phone number to E.164, or return null if it cannot be
 * a valid phone number. Never throws.
 */
export function normalizePhone(raw: string): string | null {
  const stripped = raw.replace(/[\s\-().]/g, "");
  if (stripped.length === 0) return null;

  let candidate: string;
  if (stripped.startsWith("+")) {
    candidate = stripped;
  } else if (stripped.startsWith("00")) {
    candidate = `+${stripped.slice(2)}`;
  } else if (IQ_LOCAL_MOBILE.test(stripped)) {
    candidate = `+${IQ_COUNTRY_CODE}${stripped.slice(1)}`;
  } else if (stripped.startsWith(IQ_COUNTRY_CODE)) {
    candidate = `+${stripped}`;
  } else {
    return null;
  }

  if (!E164.test(candidate)) return null;

  // Iraqi numbers must be mobile-shaped: +9647 followed by exactly 9 digits.
  if (candidate.startsWith(`+${IQ_COUNTRY_CODE}`)) {
    if (!/^\+9647\d{9}$/.test(candidate)) return null;
  }

  return candidate;
}
