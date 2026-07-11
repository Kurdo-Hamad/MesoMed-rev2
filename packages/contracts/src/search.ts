/**
 * Search module API contracts (MM-PLAN-001 §5 Phase 3). The search module
 * serves its own read models (FTS + pg_trgm), refreshed from directory
 * events — results are card-shaped pointers back into the directory.
 */
import { z } from "zod";
import { localizedTextSchema } from "./events/directory.js";

export const SEARCHABLE_ENTITY_TYPES = ["facility", "doctor"] as const;

export const searchInputSchema = z.object({
  query: z.string().min(1).max(200),
  entityType: z.enum(SEARCHABLE_ENTITY_TYPES).optional(),
  /** Facility category slug or doctor specialty key. */
  categoryKey: z.string().min(1).max(100).optional(),
  citySlug: z.string().min(1).max(100).optional(),
  limit: z.number().int().min(1).max(50).default(12),
});

export const searchResultItemSchema = z.object({
  entityType: z.enum(SEARCHABLE_ENTITY_TYPES),
  entityId: z.string(),
  slug: z.string(),
  name: localizedTextSchema,
  categoryKey: z.string(),
  citySlug: z.string().nullable(),
  rank: z.number().int(),
});

export const searchOutputSchema = z.object({
  items: z.array(searchResultItemSchema),
});
