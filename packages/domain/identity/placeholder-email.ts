/**
 * Identity module — placeholder emails for phone-keyed accounts (pure).
 *
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
