-- MM-QA-004 F-13: ar/ckb search-text normalization, identical at index and
-- query time. Adds search_documents.search_text — the folded match column
-- the search subscribers write (normalizeSearchText) and search.listings
-- matches against — backfills it for existing rows in SQL, rebases the
-- generated search_vector onto it, and replaces the three per-locale name
-- trigram indexes with one on search_text. name_en/ar/ckb are display
-- columns and stay raw — clients keep receiving the original forms.
--
-- The backfill fold below MUST mirror
-- packages/domain/search/normalize-search-text.ts EXACTLY:
--   NFC normalize
--   -> strip tatweel U+0640 + Arabic diacritics U+064B-U+065F, U+0670
--   -> fold alef variants U+0622/0623/0625/0671 -> U+0627
--   -> fold waw-hamza U+0624 -> U+0648
--   -> fold yeh variants U+0626/0649/06CC -> U+064A
--   -> fold keheh U+06A9 -> U+0643
--   -> fold heh variants U+0629/06BE/06D5 -> U+0647
--   -> fold Arabic-Indic U+0660-0669 and extended U+06F0-06F9 digits -> 0-9
--   -> lower -> collapse whitespace runs -> trim
-- The SQL<->JS pairing is pinned by
-- apps/api/test/search/search-text-fold.test.ts, which re-executes the
-- UPDATE below against JS-computed expectations — change either side only
-- together with the other. (lower() and \s match their JS counterparts
-- over this data: Arabic script is caseless, Latin names are ASCII, and
-- whitespace is plain ASCII whitespace.)
--
-- Ships as a NEW migration (F-21 rule — 0002 is never edited). Statements
-- are guarded so a partial or repeated run converges; the WHERE clause
-- limits the backfill to rows still carrying the additive default ''.
ALTER TABLE "search_documents" ADD COLUMN IF NOT EXISTS "search_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE "search_documents"
SET "search_text" = btrim(regexp_replace(lower(translate(
  regexp_replace(
    normalize("name_en" || ' ' || "name_ar" || ' ' || "name_ckb", NFC),
    '[\u0640\u064B-\u065F\u0670]', '', 'g'),
  U&'\0622\0623\0625\0671\0624\0626\0649\06CC\06A9\0629\06BE\06D5\0660\0661\0662\0663\0664\0665\0666\0667\0668\0669\06F0\06F1\06F2\06F3\06F4\06F5\06F6\06F7\06F8\06F9',
  U&'\0627\0627\0627\0627\0648\064A\064A\064A\0643\0647\0647\0647' || '01234567890123456789'
)), '\s+', ' ', 'g'))
WHERE "search_text" = '';--> statement-breakpoint
DROP INDEX IF EXISTS "search_documents_name_en_trgm_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "search_documents_name_ar_trgm_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "search_documents_name_ckb_trgm_idx";--> statement-breakpoint
ALTER TABLE "search_documents" DROP COLUMN IF EXISTS "search_vector";--> statement-breakpoint
ALTER TABLE "search_documents" ADD COLUMN "search_vector" tsvector GENERATED ALWAYS AS (to_tsvector('simple', "search_text")) STORED NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "search_documents_search_text_trgm_idx" ON "search_documents" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "search_documents_search_vector_idx" ON "search_documents" USING gin ("search_vector");
