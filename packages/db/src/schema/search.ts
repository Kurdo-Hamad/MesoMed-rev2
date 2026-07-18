import { sql, type SQL } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Search module read model (MM-PLAN-001 §5 Phase 3) — owned exclusively by
 * `apps/api/src/modules/search` (§3.1). Populated only from directory event
 * payloads by the module's outbox subscribers; search never joins directory
 * tables. Matching runs against `search_text` — the trilingual names folded
 * by normalizeSearchText (MM-QA-004 F-13), written by the subscribers and
 * GIN-trigram-indexed (the 0002 migration enables pg_trgm) — plus FTS over
 * the generated tsvector. name_en/ar/ckb stay raw: they are display columns.
 */

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

export const SEARCH_ENTITY_TYPES = ["facility", "doctor"] as const;
export type SearchEntityType = (typeof SEARCH_ENTITY_TYPES)[number];

export const searchDocuments = pgTable(
  "search_documents",
  {
    entityType: text("entity_type", { enum: SEARCH_ENTITY_TYPES }).notNull(),
    entityId: uuid("entity_id").notNull(),
    slug: text("slug").notNull(),
    nameEn: text("name_en").notNull(),
    nameAr: text("name_ar").notNull(),
    nameCkb: text("name_ckb").notNull(),
    /** Facility category slug or doctor specialty key. */
    categoryKey: text("category_key").notNull(),
    citySlug: text("city_slug"),
    publiclyVisible: boolean("publicly_visible").notNull().default(false),
    /** Result ordering rank (facility tier rank; doctors default 3). */
    rank: integer("rank").notNull().default(3),
    /**
     * Folded match text: normalizeSearchText over "nameEn nameAr nameCkb"
     * (MM-QA-004 F-13). Written by the indexing subscribers with the same
     * fold the query side applies; migration 0013 backfills it in SQL.
     * NOT NULL DEFAULT '' keeps the column addition additive.
     */
    searchText: text("search_text").notNull().default(""),
    /**
     * FTS document over the folded search text ('simple' config — no single
     * language fits en/ar/ckb; trigram matching covers typo tolerance).
     */
    searchVector: tsvector("search_vector")
      .notNull()
      .generatedAlwaysAs((): SQL => sql`to_tsvector('simple', ${searchDocuments.searchText})`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.entityType, table.entityId] }),
    index("search_documents_search_text_trgm_idx").using(
      "gin",
      table.searchText.op("gin_trgm_ops"),
    ),
    index("search_documents_search_vector_idx").using("gin", table.searchVector),
    check("search_documents_entity_type_check", sql`${table.entityType} in ('facility', 'doctor')`),
  ],
);
