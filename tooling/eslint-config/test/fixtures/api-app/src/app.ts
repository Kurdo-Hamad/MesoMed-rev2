// ALLOWED: the composition root is the one place concrete adapters are wired
// (MM-PLAN-001 §3.8).
import { createTwilioSmsAdapter } from "@mesomed/platform/adapters";

export const composition = { createTwilioSmsAdapter };
