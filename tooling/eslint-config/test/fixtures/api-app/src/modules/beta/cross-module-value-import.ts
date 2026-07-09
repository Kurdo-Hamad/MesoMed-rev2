// VIOLATION (MM-PLAN-001 §3.1): a module value-importing another module's
// internals. Uses a NodeNext `.js`-suffixed specifier on purpose — the
// guardrail must see through the extension aliasing.
import { alphaSecret } from "../alpha/internal.js";

export const betaUsesAlpha = alphaSecret + 1;
