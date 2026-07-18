// VIOLATION (MM-PLAN-001 repo layout, MM-QA-004 F-09): pure domain logic
// must not depend on platform adapters, not even their interfaces.
import { createMockOtpChannel } from "@mesomed/platform";

export const usesPlatform = createMockOtpChannel;
