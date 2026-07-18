// ALLOWED (MM-QA-004 F-08): the table-free shared core (client factory,
// query operators) is importable from any module.
import { eq } from "@mesomed/db/core";

export const betaUsesCore = eq;
