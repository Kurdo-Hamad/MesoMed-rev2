/**
 * Phone-number normalization and phone-keyed placeholder emails — a wire
 * contract, not just a domain rule: the API rejects un-normalized
 * `phoneNumber` payloads, so every client must produce the same E.164
 * form before calling. Self-contained on purpose (no relative imports):
 * web/mobile bundle this file directly. `packages/domain/identity`
 * re-exports these for server-side callers.
 *
 * Patient profiles are keyed on the normalized phone (MM-DEC rev02 §1/§9).
 * Iraq is the default region: local mobiles (07XXXXXXXXX) normalize to
 * +9647XXXXXXXXX; E.164 input (any country) passes through validation.
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

/**
 * Better Auth requires every user to have an email. Patients register with
 * phone + password (MM-DEC rev02 §2), so their user row carries a
 * deterministic placeholder derived from the normalized phone. The
 * `.invalid` TLD is reserved (RFC 2606) and can never route mail; the
 * EmailChannel must additionally refuse to send to these addresses.
 */
const PLACEHOLDER_DOMAIN = "phone.mesomed.invalid";

/** Derive the placeholder email for a normalized (E.164) phone number. */
export function placeholderEmailForPhone(normalizedPhone: string): string {
  return `p${normalizedPhone.replace(/^\+/, "")}@${PLACEHOLDER_DOMAIN}`;
}

export function isPlaceholderEmail(email: string): boolean {
  return email.endsWith(`@${PLACEHOLDER_DOMAIN}`);
}
