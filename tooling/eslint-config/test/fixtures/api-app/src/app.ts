// ALLOWED: the composition root is the one place concrete adapters are wired
// (MM-PLAN-001 §3.8).
import { fakeAdapter } from "@mesomed/platform/adapters/fake";

export const composition = { fakeAdapter };
