// Concrete vendor adapters (MM-PLAN-001 §3.8): importable ONLY by the
// apps/api composition root, which wires them via env/config. Module,
// kernel, domain and client code imports the adapter interfaces from the
// root entrypoint instead — the shared eslint config bans this path
// everywhere else (MM-QA-004 F-10).
export {
  createMetaWhatsAppAdapter,
  type MetaWhatsAppAdapter,
  type MetaWhatsAppAdapterOptions,
} from "./whatsapp-meta.js";
export {
  createTwilioSmsAdapter,
  type TwilioSmsAdapter,
  type TwilioSmsAdapterOptions,
} from "./sms-twilio.js";
export { createExpoPushAdapter, type ExpoPushAdapterOptions } from "./push-expo.js";
export { createResendEmailAdapter, type ResendEmailAdapterOptions } from "./email-resend.js";
export {
  createAnthropicAiGateway,
  DEFAULT_ANTHROPIC_TRIAGE_MODEL,
  type AnthropicAiGatewayOptions,
} from "./ai-anthropic.js";
