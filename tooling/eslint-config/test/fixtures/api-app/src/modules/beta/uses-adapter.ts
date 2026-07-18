// VIOLATION (MM-PLAN-001 §3.8): module code importing a concrete platform
// adapter instead of the interface entrypoint.
import { createTwilioSmsAdapter } from "@mesomed/platform/adapters";

export const usesAdapter = createTwilioSmsAdapter;
