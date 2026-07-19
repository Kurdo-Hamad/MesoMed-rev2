/**
 * Public listing search (MM-PLAN-001 §5 Phase 3): pg_trgm substring match
 * against the folded search_text column (GIN trigram-indexed) OR'd with a
 * 'simple'-config FTS match — reads only the module's own read model. The
 * query is folded with the SAME normalizeSearchText the indexing
 * subscribers apply (MM-QA-004 F-13), so ar/ckb letter-form variants match
 * regardless of which form was typed on either side.
 */
import type { z } from "zod";
import type { searchInputSchema, searchOutputSchema } from "@mesomed/contracts/search";
import {
  and,
  asc,
  eq,
  or,
  searchDocuments,
  sql,
  type Db,
  type SQL,
} from "@mesomed/db/modules/search";
import { normalizeSearchText } from "@mesomed/domain/search";
import { packText } from "@mesomed/contracts/directory";
import { recordSearchListing } from "../../../kernel/metrics.js";

export type SearchInput = z.output<typeof searchInputSchema>;
export type SearchOutput = z.output<typeof searchOutputSchema>;

export async function searchListings(
  db: Db,
  country: string,
  input: SearchInput,
): Promise<SearchOutput> {
  const startedAt = performance.now();
  const query = normalizeSearchText(input.query);
  // The contract's min length 1 can still fold to empty (e.g. a
  // diacritics-only query) — an empty pattern would match every row.
  if (query === "") return { items: [] };
  const like = `%${query}%`;

  const conditions: SQL[] = [
    eq(searchDocuments.publiclyVisible, true),
    // Country scoping (ADR-0055): documents indexed before the country
    // field existed carry NULL and stay out of results until the seed
    // re-run re-emits their directory events.
    eq(searchDocuments.countryIso, country),
    or(
      sql`${searchDocuments.searchText} ilike ${like}`,
      sql`${searchDocuments.searchVector} @@ plainto_tsquery('simple', ${query})`,
    )!,
  ];
  if (input.entityType) conditions.push(eq(searchDocuments.entityType, input.entityType));
  if (input.categoryKey) conditions.push(eq(searchDocuments.categoryKey, input.categoryKey));
  if (input.citySlug) conditions.push(eq(searchDocuments.citySlug, input.citySlug));

  const rows = await db
    .select({
      entityType: searchDocuments.entityType,
      entityId: searchDocuments.entityId,
      slug: searchDocuments.slug,
      nameEn: searchDocuments.nameEn,
      nameAr: searchDocuments.nameAr,
      nameCkb: searchDocuments.nameCkb,
      categoryKey: searchDocuments.categoryKey,
      citySlug: searchDocuments.citySlug,
      rank: searchDocuments.rank,
    })
    .from(searchDocuments)
    .where(and(...conditions))
    .orderBy(asc(searchDocuments.rank), asc(searchDocuments.nameEn), asc(searchDocuments.entityId))
    .limit(input.limit);

  // ADR-0030's revisit trigger is "search p95 > 100 ms"; the HTTP histogram
  // cannot see individual tRPC procedures, so this query times itself
  // (MM-QA-004 F-25, ADR-0054).
  recordSearchListing(performance.now() - startedAt);

  return {
    items: rows.map((row) => ({
      entityType: row.entityType,
      entityId: row.entityId,
      slug: row.slug,
      name: packText(row.nameEn, row.nameAr, row.nameCkb),
      categoryKey: row.categoryKey,
      citySlug: row.citySlug,
      rank: row.rank,
    })),
  };
}
