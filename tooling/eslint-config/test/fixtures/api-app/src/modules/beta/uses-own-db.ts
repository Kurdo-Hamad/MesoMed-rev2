// ALLOWED (MM-QA-004 F-08): a module importing its OWN @mesomed/db
// entrypoint — the sanctioned path to its tables.
import { betaTable } from "@mesomed/db/modules/beta";

export const betaUsesOwn = betaTable;
