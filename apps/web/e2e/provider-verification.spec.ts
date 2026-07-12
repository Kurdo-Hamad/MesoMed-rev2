import { expect, test, type Page } from "@playwright/test";
import { fill, web } from "./messages";

/**
 * Provider signup → verification → visibility (MM-DEC §3):
 * 1. A fresh provider signs up on the web and sees the verify-email
 *    notice (email verification precedes review).
 * 2. The admin approves the fixture's pending provider (created verified,
 *    with a hidden directory listing linked by identityProfileId).
 * 3. The listing becomes publicly visible in the directory — the
 *    event-driven flip (identity → directory outbox event), observed
 *    end-to-end through the public page.
 */
const t = web("en");

const ADMIN = { email: "admin@e2e.mesomed.example", password: "E2ePassword!234" };
const PENDING_LISTING_NAME = "Dr. Pending Provider";
const PENDING_LISTING_SLUG = "dr-pending-provider";
/** seed-e2e.ts: seedUuid("f", 900) — the pending provider's listing. */
const PENDING_DOCTOR_PROFILE_ID = "00000000-0000-4000-9f00-000000000900";
const API_URL = "http://localhost:4000";

async function signInAsAdmin(page: Page): Promise<void> {
  await page.goto("/en/auth/sign-in");
  await page.getByRole("tab", { name: t.auth.providerTab }).click();
  await page.getByLabel(t.auth.email).fill(ADMIN.email);
  await page.getByLabel(t.auth.password).fill(ADMIN.password);
  await page.getByRole("button", { name: t.auth.signIn, exact: true }).click();
  await page.waitForURL(/\/dashboard/);
}

test("fresh provider signup shows the verification notice", async ({ page }) => {
  await page.goto("/en/auth/sign-up");
  await page.getByRole("tab", { name: t.auth.providerTab }).click();
  await expect(page.getByText(t.auth.providerSignupNote)).toBeVisible();

  const unique = Date.now() % 1_000_000;
  const email = `provider-${unique}@e2e.mesomed.example`;
  await page.getByLabel(t.auth.fullName).fill("Dr. Fresh Signup");
  await page.getByLabel(t.auth.email).fill(email);
  await page.getByLabel(t.auth.phone).fill(`+96477099${String(unique % 100_000).padStart(5, "0")}`);
  await page.getByLabel(t.auth.password).fill("FreshProvider!234");
  await page.getByRole("button", { name: t.auth.signUp, exact: true }).click();

  await expect(page.getByText(fill(t.auth.providerEmailSent, { email }))).toBeVisible();
});

test("admin approval flips the pending provider's directory visibility", async ({ page }) => {
  // The public probe is the doctor DETAIL page: doctorDetail filters on
  // publicly_visible, so a hidden listing renders the not-found state —
  // unlike the browse list, where pagination could hide a visible doctor.
  // Approval + subscription persist on the shared harness, so a retried
  // attempt starts past the flip — only run the admin acts when the
  // listing is still hidden.
  await page.goto(`/en/doctor/${PENDING_LISTING_SLUG}`);
  const alreadyVisible =
    (await page.getByRole("heading", { name: PENDING_LISTING_NAME }).count()) > 0;
  if (alreadyVisible) return;

  await expect(page.getByText(t.doctor.notFound)).toBeVisible();

  await signInAsAdmin(page);
  await page.goto("/en/dashboard/admin");
  await expect(page.getByRole("heading", { name: t.dashboard.providerQueue })).toBeVisible();

  const queueRow = page.locator("li", { hasText: "pending-provider@e2e.mesomed.example" });
  await expect(queueRow).toBeVisible();
  await queueRow.getByRole("button", { name: t.dashboard.approve }).click();
  await expect(queueRow).toHaveCount(0);

  // Identity-linked doctors are visible only with an ACTIVE subscription
  // on top of approval (Phase 6 rule, directory.doctorPubliclyVisible).
  // The admin dashboard has no subscription screen yet, so the second
  // admin act rides the typed admin procedure with the browser session.
  const subscription = await page.request.post(
    `${API_URL}/trpc/billing.recordSubscriptionPayment`,
    {
      data: {
        idempotencyKey: `e2e-sub-${Date.now()}`,
        doctorProfileId: PENDING_DOCTOR_PROFILE_ID,
        periods: 1,
        amount: 50_000,
        currency: "IQD",
      },
    },
  );
  expect(subscription.ok()).toBe(true);

  // Visibility is eventually consistent (outbox → directory recompute →
  // cache invalidation); poll the public detail page until the flip lands.
  await expect
    .poll(
      async () => {
        await page.goto(`/en/doctor/${PENDING_LISTING_SLUG}`);
        return page.getByRole("heading", { name: PENDING_LISTING_NAME }).count();
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);
});
