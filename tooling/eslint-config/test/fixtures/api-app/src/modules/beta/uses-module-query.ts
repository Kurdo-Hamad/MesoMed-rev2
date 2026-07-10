// ALLOWED (MM-PLAN-001 §3.1): cross-module reads go through the other
// module's published query functions — its queries/ folder.
import { listAlphaThings } from "../alpha/queries/published.js";

export const betaReadsAlpha = listAlphaThings().length;
