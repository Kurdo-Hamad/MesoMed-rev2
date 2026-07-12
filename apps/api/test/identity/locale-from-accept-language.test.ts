import { describe, expect, it } from "vitest";
import { localeFromAcceptLanguage } from "../../src/modules/identity/auth.js";

describe("localeFromAcceptLanguage (ADR-0011 F-13)", () => {
  it("returns undefined when the header is missing or empty", () => {
    expect(localeFromAcceptLanguage(undefined)).toBeUndefined();
    expect(localeFromAcceptLanguage(null)).toBeUndefined();
    expect(localeFromAcceptLanguage("")).toBeUndefined();
  });

  it("matches a supported locale's primary subtag", () => {
    expect(localeFromAcceptLanguage("en-US,en;q=0.9")).toBe("en");
    expect(localeFromAcceptLanguage("ar")).toBe("ar");
    expect(localeFromAcceptLanguage("ckb")).toBe("ckb");
  });

  it("maps the generic Kurdish macrolanguage tag to the platform's ckb catalog", () => {
    expect(localeFromAcceptLanguage("ku,en;q=0.5")).toBe("ckb");
  });

  it("falls through multiple tags to the first recognized one", () => {
    expect(localeFromAcceptLanguage("fr-FR,fr;q=0.9,en;q=0.8")).toBe("en");
  });

  it("returns undefined when nothing in the header is recognized", () => {
    expect(localeFromAcceptLanguage("fr-FR,de;q=0.8")).toBeUndefined();
  });
});
