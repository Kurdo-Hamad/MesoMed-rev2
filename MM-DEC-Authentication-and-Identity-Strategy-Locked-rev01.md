MesoMed Authentication & Identity Strategy (Locked)

Status: Approved / Locked Purpose: Define the long-term authentication,
identity, and notification strategy for MesoMed.

1.  Patient Experience

Patients can browse the platform without creating an account.

Patients can search doctors, hospitals, laboratories, pharmacies, home
nursing providers, and use symptom search without signing in.

Patients can book appointments without creating an account.

During booking, patients provide: Full Name, Phone Number (required),
Date of Birth, Gender (when clinically relevant), and Email
(recommended; required for online payments and optional account
creation).

The system automatically creates an internal patient profile to preserve
appointment history and future medical records.

2.  Optional Patient Account

Patient accounts are optional.

Benefits include appointment history, medical records, prescriptions,
laboratory results, saved providers, and faster booking.

Registration requires Email, Password, Email Verification, and Phone
Number.

No WhatsApp OTP is required during normal registration.

3.  Service Provider Accounts

Accounts are mandatory for doctors, hospitals, laboratories, pharmacies,
home nursing providers, secretaries, and administrators.

Required information: Email, Password, Verified Email, and Phone Number.

4.  Authentication

Standard login uses Email + Password.

No OTP is sent during normal login.

Users remain signed in until they manually log out, replace their
device, revoke sessions, or a security event requires re-authentication.

Mobile devices may use biometric authentication (Face ID/Fingerprint)
after the first successful login.

5.  Password Recovery

Primary recovery method: verified email.

Service providers may use WhatsApp OTP only when email recovery is
unavailable or unsuccessful.

In exceptional cases, MesoMed administrators may manually recover
provider accounts after identity verification.

6.  Notifications

Primary notification channel: Push Notifications.

Use push notifications for appointment reminders, queue updates, booking
confirmations, prescription notifications, and laboratory result
notifications.

SMS is not part of routine authentication or notifications.

7.  Guiding Principles

Minimize friction for patients.

Keep recurring communication costs low.

Provide stronger security for service providers.

Preserve patient history without requiring mandatory registration.

Maintain a premium mobile experience with persistent login and biometric
authentication.

Decision Summary

This authentication strategy is approved as the baseline architecture
for MesoMed. It prioritizes patient accessibility, low operating costs,
secure provider access, and long-term scalability.
