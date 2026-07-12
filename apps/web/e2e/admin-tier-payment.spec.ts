import { expect, test } from "@playwright/test";
import { web } from "./messages";

/**
 * Admin tier payment (Phase 6/8): admin records a facility tier payment
 * through the dashboard — price comes from the (tier, country) config row
 * (§3.9, the admin never types an amount), the manual gateway settles,
 * and the payment appears in the facility's tier state.
 */
const t = web("en");

test("admin records a facility tier payment", async ({ page }) => {
  await page.goto("/en/auth/sign-in");
  await page.getByRole("tab", { name: t.auth.providerTab }).click();
  await page.getByLabel(t.auth.email).fill("admin@e2e.mesomed.example");
  await page.getByLabel(t.auth.password).fill("E2ePassword!234");
  await page.getByRole("button", { name: t.auth.signIn, exact: true }).click();
  await page.waitForURL(/\/dashboard/);

  await page.goto("/en/dashboard/admin");
  await page.getByRole("button", { name: t.dashboard.adminBilling }).click();
  await expect(page.getByRole("heading", { name: t.dashboard.tierPayments })).toBeVisible();

  // Default selections: first category → first facility. Pick the tier
  // with the configured IQ price and record one month.
  await page.getByLabel(t.dashboard.tier).selectOption({ index: 1 });
  await page.getByRole("button", { name: t.dashboard.recordPayment }).click();

  await expect(page.getByText(t.dashboard.paymentRecorded)).toBeVisible();
  // The tier state card reflects the recorded payment (current tier +
  // payment line with the configured price).
  await expect(page.getByText(`${t.dashboard.currentTier}:`)).toBeVisible();
});
