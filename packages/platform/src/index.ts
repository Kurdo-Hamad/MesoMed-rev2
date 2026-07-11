// Adapter interfaces (MM-PLAN-001 §3.8): module code imports interfaces
// from this package only; concrete providers are wired in the apps/api
// composition root. Adapters are added one at a time as each becomes
// real — Phase 2 adds OTP + email with mock providers.
export { OtpSendError, type OtpChannel, type OtpChannelKind, type OtpMessage } from "./otp.js";
export { createMockOtpChannel, type MockOtpChannel } from "./otp-mock.js";
export { EmailSendError, type EmailChannel, type EmailMessage } from "./email.js";
export { createMockEmailChannel, type MockEmailChannel } from "./email-mock.js";
