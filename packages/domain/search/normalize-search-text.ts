/**
 * Search-text fold (MM-QA-004 F-13): the single normalization applied to
 * ar/ckb/en listing text at BOTH index time (search module subscribers)
 * and query time (search.listings), so letter-form variants — hamza
 * alefs, alef maqsura vs yeh, Arabic vs Farsi/Sorani kaf and yeh, teh
 * marbuta vs heh, Arabic-Indic digits — match regardless of which form
 * the writer or the searcher typed.
 *
 * The SQL backfill in packages/db/migrations/0013_search_text_normalization.sql
 * MUST implement this exact fold; the pairing is pinned by
 * apps/api/test/search/search-text-fold.test.ts. Change either side only
 * together with the other.
 *
 * Pure and dependency-free (domain purity rule). Display text is never
 * folded — this feeds only the search_text/search_vector match columns.
 */

/** Tatweel (U+0640) + Arabic diacritics (U+064B–U+065F, U+0670): stripped. */
const STRIPPED_MARKS = /\u0640|[\u064B-\u065F]|\u0670/g;
/** Alef variants: madda U+0622, hamza above U+0623, hamza below U+0625, wasla U+0671 → bare alef U+0627. */
const ALEF_VARIANTS = /[\u0622\u0623\u0625\u0671]/g;
/** Waw with hamza U+0624 → waw U+0648. */
const WAW_HAMZA = /\u0624/g;
/** Yeh with hamza U+0626, alef maqsura U+0649, Farsi/Sorani yeh U+06CC → Arabic yeh U+064A. */
const YEH_VARIANTS = /[\u0626\u0649\u06CC]/g;
/** Farsi/Sorani kaf (keheh) U+06A9 → Arabic kaf U+0643. */
const KEHEH = /\u06A9/g;
/** Teh marbuta U+0629, heh doachashmee U+06BE, Sorani ae U+06D5 → heh U+0647. */
const HEH_VARIANTS = /[\u0629\u06BE\u06D5]/g;
/** Arabic-Indic digits U+0660–U+0669 → ASCII 0–9. */
const ARABIC_INDIC_DIGITS = /[\u0660-\u0669]/g;
/** Extended (Farsi/Sorani) Arabic-Indic digits U+06F0–U+06F9 → ASCII 0–9. */
const EXTENDED_ARABIC_INDIC_DIGITS = /[\u06F0-\u06F9]/g;

export function normalizeSearchText(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(STRIPPED_MARKS, "")
    .replace(ALEF_VARIANTS, "\u0627")
    .replace(WAW_HAMZA, "\u0648")
    .replace(YEH_VARIANTS, "\u064A")
    .replace(KEHEH, "\u0643")
    .replace(HEH_VARIANTS, "\u0647")
    .replace(ARABIC_INDIC_DIGITS, (digit) =>
      String.fromCharCode(digit.charCodeAt(0) - 0x0660 + 0x30),
    )
    .replace(EXTENDED_ARABIC_INDIC_DIGITS, (digit) =>
      String.fromCharCode(digit.charCodeAt(0) - 0x06f0 + 0x30),
    )
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
