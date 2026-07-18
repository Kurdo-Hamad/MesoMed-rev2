import { describe, expect, it } from "vitest";
import { normalizeSearchText } from "./normalize-search-text.js";

/**
 * MM-QA-004 F-13. Fixtures are built from \uXXXX escapes: several pairs
 * under test (Arabic vs Farsi/Sorani kaf and yeh, heh forms) render
 * identically, and the codepoint distinction IS the behavior under test.
 */
const fold = normalizeSearchText;

// mustashfa "hospital" (ar): alef maqsura U+0649 vs yeh U+064A ending.
const HOSPITAL_MAQSURA = "مستشفى";
const HOSPITAL_YEH = "مستشفي";
// duktor "doctor" (ckb): Sorani keheh U+06A9 vs Arabic kaf U+0643 (waw U+06C6 stays).
const DOCTOR_KEHEH = "دکتۆر";
const DOCTOR_KAF = "دكتۆر";
// Ahmed: alef-with-hamza U+0623 vs bare alef U+0627.
const AHMED_HAMZA = "أحمد";
const AHMED_BARE = "احمد";
// Same word decomposed: alef U+0627 + combining hamza above U+0654.
const AHMED_DECOMPOSED = "أحمد";
// iyada "clinic" (ar): teh marbuta U+0629 vs heh U+0647 ending.
const CLINIC_MARBUTA = "عيادة";
const CLINIC_HEH = "عياده";
// mu'assasa "institution": waw-with-hamza U+0624 folds to waw U+0648.
const INSTITUTION_HAMZA = "مؤسسة";
const INSTITUTION_FOLDED = "موسسه";
// Sorani zhin "life": zhe U+0698 stays, Sorani yeh U+06CC folds to U+064A.
const ZHIN = "ژین";
const ZHIN_FOLDED = "ژين";
// Sorani ewara "evening": yeh-hamza U+0626 folds, U+06CE stays, ae U+06D5 folds to heh.
const EWARA = "ئێوارە";
const EWARA_FOLDED = "يێواره";
// Sorani nexoshxane "hospital": both U+06D5 fold to heh, U+06C6 stays.
const NEXOSHXANE = "نەخۆشخانە";
const NEXOSHXANE_FOLDED = "نهخۆشخانه";
// al-arabiya with diacritics (U+064E fatha, U+0650 kasra) + teh marbuta ending.
const ARABIC_DIACRITIZED = "العَرَبِية";
const ARABIC_PLAIN = "العربيه";
// Muhammad stretched with tatweel U+0640 between every letter.
const MUHAMMAD_TATWEEL = "مـحـمـد";
const MUHAMMAD_PLAIN = "محمد";

describe("normalizeSearchText", () => {
  it("folds alef maqsura to yeh (mustashfa spelled both ways matches)", () => {
    expect(fold(HOSPITAL_MAQSURA)).toBe(HOSPITAL_YEH);
    expect(fold(HOSPITAL_MAQSURA)).toBe(fold(HOSPITAL_YEH));
  });

  it("folds Sorani keheh U+06A9 to Arabic kaf U+0643 (duktor spelled both ways matches)", () => {
    expect(fold(DOCTOR_KEHEH)).toBe(DOCTOR_KAF);
    expect(fold(DOCTOR_KEHEH)).toBe(fold(DOCTOR_KAF));
  });

  it("folds hamza-carrying alef to bare alef (Ahmed spelled both ways matches)", () => {
    expect(fold(AHMED_HAMZA)).toBe(AHMED_BARE);
  });

  it("NFC-composes decomposed hamza before folding (alef + U+0654 behaves like U+0623)", () => {
    expect(fold(AHMED_DECOMPOSED)).toBe(AHMED_BARE);
  });

  it("folds teh marbuta to heh (iyada spelled both ways matches)", () => {
    expect(fold(CLINIC_MARBUTA)).toBe(CLINIC_HEH);
  });

  it("folds waw with hamza to waw", () => {
    expect(fold(INSTITUTION_HAMZA)).toBe(INSTITUTION_FOLDED);
  });

  it("folds genuine Sorani words, leaving Sorani-only letters intact", () => {
    expect(fold(ZHIN)).toBe(ZHIN_FOLDED);
    expect(fold(EWARA)).toBe(EWARA_FOLDED);
    expect(fold(NEXOSHXANE)).toBe(NEXOSHXANE_FOLDED);
  });

  it("folds Arabic-Indic and extended digits to ASCII", () => {
    expect(fold("٢٠٢٦")).toBe("2026");
    expect(fold("۲۰۲۶")).toBe("2026");
    expect(fold("٠١٢٣٤٥٦٧٨٩")).toBe("0123456789");
    expect(fold("۰۱۲۳۴۵۶۷۸۹")).toBe("0123456789");
  });

  it("lowercases Latin text", () => {
    expect(fold("Zheen General Hospital")).toBe("zheen general hospital");
  });

  it("strips diacritics and tatweel", () => {
    expect(fold(ARABIC_DIACRITIZED)).toBe(ARABIC_PLAIN);
    expect(fold(MUHAMMAD_TATWEEL)).toBe(MUHAMMAD_PLAIN);
  });

  it("collapses whitespace runs and trims", () => {
    expect(fold("  Zheen \t General \n Hospital  ")).toBe("zheen general hospital");
  });

  it("is idempotent: fold(fold(x)) == fold(x) for every fixture", () => {
    const fixtures = [
      HOSPITAL_MAQSURA,
      DOCTOR_KEHEH,
      AHMED_HAMZA,
      AHMED_DECOMPOSED,
      CLINIC_MARBUTA,
      INSTITUTION_HAMZA,
      ZHIN,
      EWARA,
      NEXOSHXANE,
      ARABIC_DIACRITIZED,
      MUHAMMAD_TATWEEL,
      `Zheen General Hospital ${HOSPITAL_MAQSURA} ۲۰۲۶`,
    ];
    for (const fixture of fixtures) {
      expect(fold(fold(fixture))).toBe(fold(fixture));
    }
  });

  it("returns empty for empty, whitespace-only, and mark-only input", () => {
    expect(fold("")).toBe("");
    expect(fold("   \t  ")).toBe("");
    // Diacritics-only input (satisfies the contract's min length 1).
    expect(fold("ًٌٍّ")).toBe("");
  });
});
