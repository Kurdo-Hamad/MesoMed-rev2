/**
 * Public listing search (MM-PLAN-001 §5 Phase 3): pg_trgm substring match
 * across all three locale name columns (each GIN trigram-indexed) OR'd with
 * a 'simple'-config FTS match — reads only the module's own read model.
 */
import type { z } from "zod";
import type { searchInputSchema, searchOutputSchema } from "@mesomed/contracts/search";
import { and, asc, eq, or, searchDocuments, sql, type Db, type SQL } from "@mesomed/db";
import { packText } from "@mesomed/contracts/directory";

export type SearchInput = z.output<typeof searchInputSchema>;
export type SearchOutput = z.output<typeof searchOutputSchema>;

export async function searchListings(db: Db, input: SearchInput): Promise<SearchOutput> {
  const query = input.query.trim();
  const like = `%${query}%`;

  const conditions: SQL[] = [
    eq(searchDocuments.publiclyVisible, true),
    or(
      sql`${searchDocuments.nameEn} ilike ${like}`,
      sql`${searchDocuments.nameAr} ilike ${like}`,
      sql`${searchDocuments.nameCkb} ilike ${like}`,
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
