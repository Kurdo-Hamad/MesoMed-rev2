/**
 * AI module contracts (MM-PLAN-001 §5 Phase 7). The triage procedure maps
 * free-text symptom descriptions (en/ar/ckb) onto at most three specialty
 * slugs from the live DB taxonomy. The output is closed-vocabulary by
 * construction: slugs plus a red-flag boolean — no free-text model output
 * ever reaches a client.
 */
import { z } from "zod";

/** Hard cap on accepted symptom text; longer inputs are truncated server-side. */
export const MAX_TRIAGE_TEXT_CHARS = 1000;

export const TRIAGE_ENGINES = ["model", "keyword", "red_flag"] as const;

export type TriageEngine = (typeof TRIAGE_ENGINES)[number];

export const triageInputSchema = z.object({
  text: z.string().min(1).max(MAX_TRIAGE_TEXT_CHARS),
});

export const triageOutputSchema = z.object({
  /** Emergency indicators detected — clients show emergency guidance, no specialties. */
  redFlag: z.boolean(),
  /** Whitelisted specialty slugs, max 3; empty when redFlag is true. */
  specialties: z.array(z.string()).max(3),
  engine: z.enum(TRIAGE_ENGINES),
});

export type TriageOutput = z.infer<typeof triageOutputSchema>;
