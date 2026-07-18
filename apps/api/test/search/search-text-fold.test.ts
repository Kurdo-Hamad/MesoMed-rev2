import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalizeSearchText } from "@mesomed/domain/search";
import { createTestDatabase, type TestDatabase } from "@mesomed/db/testing";

/**
 * MM-QA-004 F-13 drift guard: migration 0013 backfills
 * search_documents.search_text with a SQL implementation of the fold that
 * packages/domain/search/normalize-search-text.ts applies at index and
 * query time. The two implementations MUST stay identical. Following the
 * 0010 pattern (event-pii-redaction.test.ts), this suite seeds raw-named
 * rows the way pre-0013 writers left them (search_text at its additive
 * default ''), re-executes the shipped backfill UPDATE verbatim, and
 * asserts the SQL result equals the JS fold for a battery of real ar/ckb
 * fixtures.
 */
const MIGRATION_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../packages/db/migrations/0013_search_text_normalization.sql",
);

const backfillUpdate = readFileSync(MIGRATION_PATH, "utf8")
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .find((statement) => statement.startsWith('UPDATE "search_documents"'));

/**
 * Real trilingual listing names exercising every fold rule: alef maqsura
 * vs yeh, hamza alefs, teh marbuta, waw-hamza, Sorani keheh/yeh/ae,
 * diacritics, tatweel, Arabic-Indic + extended digits, mixed-case Latin.
 */
const FIXTURES = [
  { en: "Zheen General Hospital", ar: "مستشفى جين العام", ckb: "نەخۆشخانەی گشتی ژین" },
  { en: "Ahmed Clinic 2026", ar: "عيادة أحمد ٢٠٢٦", ckb: "کلینیکی ئەحمەد ۲۰۲۶" },
  { en: "Dr. Muayad", ar: "د. مؤيد العَرَبِية", ckb: "دکتۆر ئێوارە" },
  { en: "Muhammad Center", ar: "مركز مـحـمـد", ckb: "ناوەندی محەمەد" },
];

describe("migration 0013 — SQL backfill fold matches normalizeSearchText", () => {
  let tdb: TestDatabase;

  beforeAll(async () => {
    tdb = await createTestDatabase();
  });

  afterAll(async () => {
    await tdb.close();
  });

  it("ships a recognizable backfill UPDATE statement", () => {
    expect(backfillUpdate).toBeDefined();
    expect(backfillUpdate).toContain(`WHERE "search_text" = ''`);
  });

  it("folds seeded raw rows exactly like the JS fold, idempotently", async () => {
    for (const [i, fixture] of FIXTURES.entries()) {
      await tdb.pool.query(
        `insert into search_documents
           (entity_type, entity_id, slug, name_en, name_ar, name_ckb, category_key, publicly_visible)
         values ('facility', gen_random_uuid(), $1, $2, $3, $4, 'hospital', true)`,
        [`fold-fixture-${i}`, fixture.en, fixture.ar, fixture.ckb],
      );
    }

    const backfill = await tdb.pool.query(backfillUpdate!);
    expect(backfill.rowCount).toBe(FIXTURES.length);

    for (const [i, fixture] of FIXTURES.entries()) {
      const expected = normalizeSearchText(`${fixture.en} ${fixture.ar} ${fixture.ckb}`);
      const { rows } = await tdb.pool.query<{ search_text: string; search_vector: string }>(
        `select search_text, search_vector::text as search_vector
         from search_documents where slug = $1`,
        [`fold-fixture-${i}`],
      );
      expect(rows[0]?.search_text, `fixture ${i}`).toBe(expected);
      // The fold changed something in every fixture (raw != folded) …
      expect(expected).not.toBe(`${fixture.en} ${fixture.ar} ${fixture.ckb}`);
      // … and the rebased generated tsvector follows the folded text
      // (second token: the first can carry punctuation the parser strips).
      expect(rows[0]?.search_vector).toContain(expected.split(" ")[1]);
    }

    // Idempotent: every row is folded, so a re-run matches nothing.
    const second = await tdb.pool.query(backfillUpdate!);
    expect(second.rowCount).toBe(0);
  });
});
