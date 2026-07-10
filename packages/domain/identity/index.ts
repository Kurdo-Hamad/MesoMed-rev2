export { normalizePhone } from "./normalize-phone.js";
export { decideClaim, type ClaimDecision, type ClaimInput } from "./claim-policy.js";
export { isPlaceholderEmail, placeholderEmailForPhone } from "./placeholder-email.js";
export { evaluateOtpSendLimit, type OtpSendPolicy, type OtpSendVerdict } from "./otp-rate-limit.js";
