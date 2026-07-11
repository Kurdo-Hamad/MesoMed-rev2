// Adapter interfaces (MM-PLAN-001 §3.8): module code imports interfaces
// from this package only; concrete providers are wired in the apps/api
// composition root. Adapters are added one at a time as each becomes
// real — Phase 2 adds OTP + email with mock providers.
export { OtpSendError, type OtpChannel, type OtpChannelKind, type OtpMessage } from "./otp.js";
export { createMockOtpChannel, type MockOtpChannel } from "./otp-mock.js";
export { EmailSendError, type EmailChannel, type EmailMessage } from "./email.js";
export { createMockEmailChannel, type MockEmailChannel } from "./email-mock.js";
export {
  WebhookUnsupportedError,
  WebhookVerificationError,
  type PaymentGateway,
  type PaymentInitiation,
  type PaymentInitiationInput,
  type PaymentNotification,
  type PaymentStatus,
  type PaymentVerification,
  type WebhookInput,
} from "./payments.js";
export { createManualPaymentGateway, MANUAL_GATEWAY_ID } from "./payments-manual.js";
// Phase 7 (communication + AI) adapters.
export {
  NotifySendError,
  type NotifyChannel,
  type NotifyChannelKind,
  type NotifyMessage,
} from "./notify.js";
export { createMockNotifyChannel, type MockNotifyChannel } from "./notify-mock.js";
export {
  PushSendError,
  PushTokenInvalidError,
  type PushChannel,
  type PushMessage,
} from "./push.js";
export { createMockPushChannel, type MockPushChannel } from "./push-mock.js";
export { AiGatewayError, type AiGateway, type AiGatewayInput } from "./ai.js";
export { createMockAiGateway, type MockAiGateway } from "./ai-mock.js";
export {
  createMetaWhatsAppAdapter,
  type MetaWhatsAppAdapter,
  type MetaWhatsAppAdapterOptions,
} from "./whatsapp-meta.js";
export { createTwilioSmsAdapter, type TwilioSmsAdapter, type TwilioSmsAdapterOptions } from "./sms-twilio.js";
export { createExpoPushAdapter, type ExpoPushAdapterOptions } from "./push-expo.js";
export { createResendEmailAdapter, type ResendEmailAdapterOptions } from "./email-resend.js";
export {
  createAnthropicAiGateway,
  DEFAULT_ANTHROPIC_TRIAGE_MODEL,
  type AnthropicAiGatewayOptions,
} from "./ai-anthropic.js";
export { isMockAdapter } from "./mock-flag.js";
