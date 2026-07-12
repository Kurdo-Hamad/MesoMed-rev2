import { describe, expect, it } from "vitest";
import { LOCALES } from "@mesomed/contracts/i18n";
import { NOTIFICATION_TEMPLATES } from "@mesomed/contracts/communication";
import {
  formatAppointmentDateTime,
  pickLocalizedName,
  renderTemplate,
  resolveLocale,
  TEMPLATE_VARIANTS,
} from "../../src/modules/communication/templates.js";

describe("communication templates", () => {
  it("has every template × variant rendering in every locale", () => {
    for (const locale of LOCALES) {
      for (const template of NOTIFICATION_TEMPLATES) {
        for (const variant of TEMPLATE_VARIANTS) {
          const rendered = renderTemplate(template, variant, locale, {
            doctorName: "Dr. Amina",
            dateTime: "2026-07-13 09:00",
            locationName: "Erbil Clinic",
          });
          expect(typeof rendered).toBe("string");
          expect(rendered.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("substitutes known params and leaves an unmatched placeholder visible", () => {
    const rendered = renderTemplate("booking_confirmation", "sms", "en", {
      doctorName: "Dr. Amina",
      dateTime: "2026-07-13 09:00",
      // locationName intentionally omitted
    });
    expect(rendered).toContain("Dr. Amina");
    expect(rendered).toContain("2026-07-13 09:00");
    expect(rendered).toContain("{locationName}");
  });

  it("resolveLocale falls back to ckb for unknown or missing locales", () => {
    expect(resolveLocale(null)).toBe("ckb");
    expect(resolveLocale(undefined)).toBe("ckb");
    expect(resolveLocale("fr")).toBe("ckb");
    expect(resolveLocale("en")).toBe("en");
  });

  it("pickLocalizedName picks the matching column and falls back to ckb", () => {
    const name = { nameEn: "English", nameAr: "Arabic", nameCkb: "Kurdish" };
    expect(pickLocalizedName(name, "en")).toBe("English");
    expect(pickLocalizedName(name, "ar")).toBe("Arabic");
    expect(pickLocalizedName(name, "ckb")).toBe("Kurdish");
  });

  it("formats the appointment instant in Iraq wall-clock time", () => {
    const rendered = formatAppointmentDateTime("2026-07-13T06:30:00.000Z");
    // 06:30 UTC + 3h (Asia/Baghdad, no DST) = 09:30.
    expect(rendered).toContain("09:30");
    expect(rendered).toContain("2026");
  });
});
