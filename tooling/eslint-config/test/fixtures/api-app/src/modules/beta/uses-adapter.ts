// VIOLATION (MM-PLAN-001 §3.8): module code importing a concrete platform
// adapter instead of the interface entrypoint.
import { fakeAdapter } from "@mesomed/platform/adapters/fake";

export const usesAdapter = fakeAdapter;
