// ALLOWED (MM-QA-004 F-09): the domain allowlist — relative paths, zod, and
// the two contracts subpaths domain rules are written against.
import { z } from "zod";
import { normalizePhone } from "@mesomed/contracts/phone";
import { APPOINTMENT_ACTIONS } from "@mesomed/contracts/booking";
import { local } from "./local.js";

export const allowed = { schema: z.string(), normalizePhone, APPOINTMENT_ACTIONS, local };
