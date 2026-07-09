// VIOLATION (MM-PLAN-001 §2): kernel is shared infrastructure and must not
// depend on business modules.
import { alphaSecret } from "../modules/alpha/internal.js";

export const kernelUsesModule = alphaSecret;
