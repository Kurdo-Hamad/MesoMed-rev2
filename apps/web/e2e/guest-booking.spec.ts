import { expect, test } from "@playwright/test";
import { LOCALES, web } from "./messages";

/**
 * Guest booking end-to-end (MM-DEC §1, convention #7): no account, no OTP
 * — pick a slot, give name + phone, get a confirmation with the optional
 * account offer AFTER booking. Runs in all three locales; every asserted
 * string comes from the catalog for that locale.
 */
const DOCTOR_SLUG = "dr-ahmed-doctor";

for (const locale of LOCALES) {
  test(`guest books an appointment end-to-end (${locale})`, async ({ page }) => {
    const t = web(locale).book;

    await page.goto(`/${locale}/book/${DOCTOR_SLUG}`);
    await expect(page.getByRole("heading", { name: t.title })).toBeVisible();

    // Slot buttons render with the brand-soft treatment inside the week
    // grid; the next week always has open slots (fixture schedule is
    // 09:00–17:00 every day). Page ahead if today's week is exhausted.
    const slot = page.locator("button.bg-brand-soft").first();
    if (!(await slot.isVisible().catch(() => false))) {
      await page.getByRole("button", { name: t.nextWeek }).click();
    }
    await slot.click();

    await expect(page.getByRole("heading", { name: t.details })).toBeVisible();
    await page.getByLabel(t.fullName).fill("E2E Guest Patient");
    // Unique phone per locale run — each booking creates its own guest
    // profile and occupies its own slot.
    const suffix = String(Date.now() % 1_000_000).padStart(6, "0");
    const prefix = locale === "en" ? "1" : locale === "ar" ? "2" : "3";
    await page.getByLabel(t.phone).first().fill(`+96477${prefix}0${suffix}`);
    await page.getByRole("button", { name: t.submit }).click();

    await expect(page.getByRole("heading", { name: t.booked })).toBeVisible();
    // The optional account offer appears AFTER booking (§2) — never as a
    // precondition.
    await expect(page.getByText(t.accountOffer)).toBeVisible();
  });
}
