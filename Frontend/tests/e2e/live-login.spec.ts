import { test, expect } from "@playwright/test";

const EMAIL = process.env.LIVE_EMAIL ?? "harshchinchakar33@gmail.com";

test("live: open login, type email, click Send → OTP phase visible (no navigation)", async ({
  page,
}) => {
  await page.goto("/login");
  await expect(
    page.getByRole("heading", { name: /verify yourself/i }),
  ).toBeVisible();

  // Confirm tabs are clickable and switch correctly
  const mobile = page.getByRole("tab", { name: /mobile/i });
  await mobile.click();
  await expect(mobile).toHaveAttribute("aria-selected", "true");

  // Back to email
  await page.getByRole("tab", { name: /email/i }).click();
  await expect(page.getByLabel(/email address/i)).toBeVisible();

  // Fill the real email and click Send
  await page.fill('input[name="identifier"]', EMAIL);
  const urlBefore = page.url();
  await page.getByRole("button", { name: /send 6-digit code/i }).click();

  // The URL must stay /login (no native GET form submission)
  await page.waitForTimeout(1500);
  expect(page.url()).toBe(urlBefore);

  // OTP phase must appear inline within 10s (allows for real SMTP roundtrip)
  await expect(
    page.getByRole("heading", { name: /enter the code/i }),
  ).toBeVisible({ timeout: 15000 });

  // Sanity check: the OTP cells are present
  const cells = page.locator('input[inputmode="numeric"]');
  await expect(cells).toHaveCount(6);

  // Persist the page state so the next test can attach to it (no-op here;
  // the next "live-verify" test re-runs send first to avoid sessionId reuse).
});
