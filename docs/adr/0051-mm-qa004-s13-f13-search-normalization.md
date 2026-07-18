# ADR-0051 — MM-QA-004 Slice 13: ar/ckb search-text normalization (F-13)

## Status

Accepted under the 2026-07-18 owner override (ADR-0031 amendment).
Closes MM-QA-002 F-08's long-open carry (ADR-0016 carry-in #2,
ADR-0024) — the primary-market recall gap.

## Context

MM-QA-004 F-13 (MEDIUM): search was `simple` FTS + pg_trgm over raw
`name_en/ar/ckb` with zero Arabic/Sorani letter-form normalization —
alef/yeh/kaf variants, diacritics, and Arabic-Indic digits all broke
recall for the primary market.

## Decision

- **One pure fold, applied identically at index and query time**
  (`packages/domain/search/normalize-search-text.ts`; the plan placed
  it in `packages/domain`, satisfying the F-09 purity allowlist —
  dependency-free): NFC → strip tatweel + diacritics (U+064B–065F,
  U+0670) → alef variants أإآٱ→ا, ؤ→و, ئ/ى/ی→ي, ک→ك, ة/ھ/ە→ه →
  Arabic-Indic and extended digits→ASCII → lowercase → whitespace
  collapse. 13 codepoint-verified unit tests with genuine ar/ckb
  fixtures.
- **Display never folded**: new `search_text` column carries the folded
  concat of the three names; `search_vector` regenerated from it; the
  three per-name trigram indexes replaced by one on `search_text`
  (migration `0013`, 0002 never edited). The indexer writes it on
  insert/upsert; the query folds the input once and matches
  `search_text ILIKE` OR the tsvector; fold-to-empty inputs return [].
- **SQL↔JS drift guard**: the migration's backfill UPDATE (a
  translate()/regexp_replace implementation of the same fold, all-ASCII
  escape literals) is re-executed verbatim in a test against seeded
  raw rows and asserted byte-equal to the JS fold, plus idempotent —
  the 0010-redaction-test pattern.
- Recall proven end-to-end through the real event flow: docs stored
  with one letter form are found via the others and via both digit
  scripts.
- Note for the next `drizzle-kit generate`: no meta snapshot was
  generated for 0011–0013 (runtime migration needs none); the snapshot
  chain reconciles at the next schema generation.

## Guardrail catch (disclosed)

The harvested search files carried `@mesomed/db` root-hub imports; the
Slice 8 write-isolation lint caught them (same class as Slice 12's
catch) and they were corrected to `@mesomed/db/modules/search` before
the gate.

## Gate

Pre-slice: format GREEN · lint/typecheck 20/20 · test 11/11 tasks,
1144 tests / 140 files, zero failed · build 3/3 — the Slice 12
post-slice gate on the tree that squash-merged verbatim to main
`ad37c25` (CI verified green, run 29643780844).
Post-slice: format GREEN · lint/typecheck 20/20 · test 11/11 tasks,
1161 tests / 142 files, zero failed · build 3/3 (domain fold suite +
the SQL↔JS pairing and recall tests).
