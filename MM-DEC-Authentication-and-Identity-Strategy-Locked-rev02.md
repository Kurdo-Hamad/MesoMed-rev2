# MesoMed Authentication & Identity Strategy (Locked) — rev02

**Status:** Approved / Locked
**Supersedes:** MM-DEC-Authentication-and-Identity-Strategy-Locked-rev01
**Purpose:** Define the long-term authentication, identity, and notification strategy for MesoMed.

> **rev02 change note.** rev01 specified email+password login for all users, email-verification-based registration, no OTP, and SMS excluded from authentication. rev02 amends this: patients authenticate with **phone + password** and verify phone ownership via **WhatsApp OTP (SMS fallback)** at account creation and recovery; providers keep **email + password** with verified email; SMS and WhatsApp gain an authentication/recovery role; biometrics are removed. Every amended section is marked **[rev02]**. This document is now the source of truth; MM-PLAN-001, CLAUDE.md, and HANDOFF-001 are reconciled to it (see §10).

---

## 1. Patient Experience

Patients can browse the platform without creating an account.

Patients can search doctors, hospitals, laboratories, pharmacies, home nursing providers, and use symptom search without signing in.

Patients can book appointments **without creating an account**. Booking is friction-free — no password and no OTP are required to complete a booking.

During booking, patients provide: Full Name, Phone Number (required), Date of Birth, Gender (when clinically relevant), and Email (optional, recommended).

The system automatically creates an internal patient profile, keyed on the **normalized phone number**, to preserve appointment history and future medical records. This profile is created in an **unverified** state at booking; phone ownership is proven later, only if the patient opts into an account (§2).

Immediately after a booking completes, the system sends the booking confirmation and offers optional account creation (§2). See §6 for which channel carries that message.

## 2. Optional Patient Account **[rev02]**

Patient accounts are **optional** and are offered **after** the first booking — never as a precondition to booking.

Creating an account upgrades the existing phone-keyed profile in place; it does not create a duplicate. Two paths:

1. **Phone account (primary):** Phone Number + Password + **WhatsApp OTP** (SMS fallback if WhatsApp is unavailable or delivery fails). Successful OTP proves the registrant owns the phone number the profile is keyed on.
2. **Email account (alternative):** Email + Password + email verification.

Because the upgrade requires proof of ownership (OTP-verified phone, or verified email), a profile — and the appointment/medical history attached to it — can only be claimed by someone who demonstrably controls the phone or email on that profile. There is no separate, unverified "claim" step and no path by which one user can claim another user's history.

Benefits of an account: appointment history, medical records, prescriptions, laboratory results, saved providers, and faster booking.

## 3. Service Provider Accounts **[rev02]**

Accounts are mandatory for doctors, hospitals, laboratories, pharmacies, home nursing providers, secretaries, and administrators.

Registration requires: Email (required, **verified**), Password, and Phone Number (required). The phone number is used for account recovery and operational communication only — it is not an authentication factor.

**Verification gate.** Providers must submit the required documentation at signup. On submission, the account is **created immediately with `status = pending`**. A pending provider can sign in to complete their profile (via the platform's provider onboarding forms) and to view their review status, but the provider's public listing does **not** go live. An administrator reviews the documentation and sets `status = approved` or `status = rejected`; the provider is notified directly on the status change. The listing becomes publicly visible only when `status = approved`.

## 4. Authentication **[rev02]**

- **Patients:** Phone Number + Password.
- **Providers:** Email + Password.

No OTP is sent during normal login for either user type.

Users remain signed in until they manually log out, change their password, complete account recovery, or a security event requires re-authentication. If a patient loses their phone, they can sign in on a new device and revoke the old session.

Biometric authentication is **not** part of this strategy in the current scope.

## 5. Password Recovery **[rev02]**

- **Patients:** WhatsApp OTP, email, or SMS — patient's choice / whichever is available.
- **Providers:** verified email → WhatsApp OTP → SMS, in that order of preference.
- In exceptional cases, MesoMed administrators may manually recover provider accounts after identity verification.

## 6. Notifications **[rev02]**

Primary notification channel: **Push Notifications**, for users who have installed the mobile app and registered a device token.

Push cannot reach a guest who booked on the web with no app installed. For those users, booking confirmation, the pre-appointment reminder, queue position, and estimated wait time are delivered over **WhatsApp (preferred) or SMS**. Once a patient installs the app and registers a token, push becomes their primary channel.

Notification events include: booking confirmation, appointment reminders (e.g. two hours before), live queue position and estimated time to be seen, prescription notifications, and laboratory result notifications.

SMS and WhatsApp now carry both an authentication/recovery role (§2, §5) and a fallback-notification role (this section). This amends rev01's exclusion of SMS from routine authentication.

**Cost note.** Because guest bookings are notified over WhatsApp/SMS rather than push, each guest booking carries a recurring per-message cost. This is an accepted trade-off in favor of friction-free booking; it is revisited if volume warrants.

## 7. Guiding Principles

Minimize friction for patients — browse and book with no account required.

Keep recurring communication costs low (subject to the §6 cost note for guest notifications).

Provide stronger security for service providers — documentation review and an explicit verification gate before a listing goes live.

Preserve patient history without requiring mandatory registration.

Maintain a premium, persistent-login mobile experience (users stay signed in until they choose otherwise).

## 8. OTP Delivery Implementation **[rev02]**

OTP is delivered WhatsApp-first, SMS-fallback, behind a single `OtpChannel` adapter interface (per MM-PLAN-001 §3.8). A **mock/log OTP provider** is used through Phase 2 — the verification flow, code storage, expiry, rate limiting, and success/failure handling are all real and tested against the mock. The real Meta WhatsApp Cloud API and SMS providers are wired in Phase 7. The Phase 2 gate proves OTP _logic_ end-to-end; real message delivery is proven in Phase 7.

## 9. Identity Model Summary **[rev02]**

- **Guest patient:** phone-keyed internal profile, created unverified at booking, no credentials.
- **Account patient:** guest profile upgraded in place via OTP-verified phone (or verified email) + password; the upgrade is the "profile claimed" transition.
- **Provider:** account created at signup with `status ∈ {pending, approved, rejected}`; login-capable while pending; publicly visible only when approved.
- Four roles remain: `patient`, `doctor`/provider, `secretary`, `admin`.
- **Walk-ins:** a secretary books a walk-in from the provider dashboard, which syncs to the doctor's calendar. The walk-in receives a WhatsApp message with a link to install MesoMed and optionally complete their profile; account creation remains optional.

## 10. Documentation Reconciliation **[rev02]**

The following must be amended so architecture documentation stays consistent with this rev02 (doc-only edits, no manufactured content):

- **MM-PLAN-001 §1 (locked stack):** Auth row → patient phone+password / provider email+password; SMS row "None" → recovery + fallback-notification adapter; WhatsApp row "Phase 7, provider recovery only" → Phase 2 (mock) / Phase 7 (real), patient registration + notification role.
- **MM-PLAN-001 §3 / CLAUDE.md convention #7:** "phone match + email verification" → "phone match + **OTP-verified phone**, or verified email." The guest→account upgrade flow and `identity.profile_claimed.v1` are retained.
- **MM-PLAN-001 §5 (Phase 2 / 4 / 7):** reflect account-at-booking-optional, provider `status` gate, OtpChannel (mock in P2), walk-in WhatsApp link.
- **HANDOFF-001 §9 / §14:** the "Better Auth implements MM-DEC exactly (email+password, no OTP)" rationale is reworded — Better Auth remains the choice, but patients now use phone+password with OTP-verified onboarding.

## Decision Summary

This amended authentication strategy is approved as the baseline architecture for MesoMed. It prioritizes friction-free patient booking, secure and ownership-verified patient accounts, verified provider onboarding, low routine cost, and long-term scalability.
