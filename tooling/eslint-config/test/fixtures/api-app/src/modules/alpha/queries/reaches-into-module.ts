// VIOLATION (MM-PLAN-001 §3.1): being a published query does not license
// reaching into ANOTHER module's internals.
import { betaCommand } from "../../beta/uses-kernel.js";

export const alphaQueryReadsBeta = betaCommand;
