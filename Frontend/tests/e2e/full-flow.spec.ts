import { test, expect } from "@playwright/test";

/**
 * Full /login → OTP → role-select flow.
 *
 * The OTP send + verify are intercepted with deterministic responses so
 * this test doesn't depend on live email delivery. The shapes mirror the
 * real /api/auth/* contract — if anything changes there, this test breaks.
 */
test("complete flow: login → OTP → role-select", async ({ page }) => {
  await page.goto("/login");

  // ---- Phase 1: identifier -------------------------------------------------
  await expect(
    page.getByRole("heading", { name: /verify yourself/i }),
  ).toBeVisible();

  // Switch to Mobile and back to prove the tabs work
  const mobileTab = page.getByRole("tab", { name: /mobile/i });
  const emailTab = page.getByRole("tab", { name: /email/i });

  await mobileTab.click();
  await expect(mobileTab).toHaveAttribute("aria-selected", "true");
  await emailTab.click();
  await expect(emailTab).toHaveAttribute("aria-selected", "true");

  await page.fill('input[name="identifier"]', "newuser@example.in");

  // Intercept the OTP send
  await page.route("**/api/auth/send-otp", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        otpId: "otp_mock_e2e",
        channel: "email",
        target: "newuser@example.in",
        display: "ne••••••@example.in",
        cooldownSec: 30,
        hint: null,
        ttlSeconds: 600,
        sentVia: "smtp",
      }),
    });
  });

  const urlBefore = page.url();
  await page.getByRole("button", { name: /send 6-digit code/i }).click();

  // URL must not change (no native GET)
  await page.waitForTimeout(800);
  expect(page.url()).toBe(urlBefore);

  // ---- Phase 2: OTP --------------------------------------------------------
  await expect(
    page.getByRole("heading", { name: /enter the code/i }),
  ).toBeVisible();
  await expect(page.getByText(/ne••••••@example.in/)).toBeVisible();

  // The 6 OTP cells must be present
  const cells = page.locator('input[inputmode="numeric"]');
  await expect(cells).toHaveCount(6);

  // Intercept the verify call as a new user (no profile)
  await page.route("**/api/auth/verify-otp", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        sessionId: "ses_mock_e2e",
        hasProfile: false,
        isFirstTime: true,
      }),
    });
  });

  // Type the code one digit per cell to prove the auto-advance works
  for (let i = 0; i < 6; i++) {
    await cells.nth(i).press(String(i + 1));
  }

  // OtpInput auto-submits on completion. Wait for the route change.
  await page.waitForURL(/\/role-select/, { timeout: 8000 });

  // ---- Phase 3: role-select page renders -----------------------------------
  await expect(page.getByText(/Choose your role/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /Taxpayer/i })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Chartered Accountant/i }),
  ).toBeVisible();
});

test("returning user: OTP verify routes straight to /dashboard", async ({
  page,
}) => {
  await page.goto("/login");
  await page.fill('input[name="identifier"]', "taxpayer@demo.glimmora.in");

  await page.route("**/api/auth/send-otp", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        otpId: "otp_returning",
        channel: "email",
        target: "taxpayer@demo.glimmora.in",
        display: "ta•••••••@demo.glimmora.in",
        cooldownSec: 30,
        hint: null,
        ttlSeconds: 600,
        sentVia: "smtp",
      }),
    });
  });

  await page.getByRole("button", { name: /send 6-digit code/i }).click();
  await expect(
    page.getByRole("heading", { name: /enter the code/i }),
  ).toBeVisible();

  await page.route("**/api/auth/verify-otp", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        sessionId: "ses_returning",
        hasProfile: true,
        role: "taxpayer",
        profileId: "usr_demo_taxpayer",
        isFirstTime: false,
      }),
    });
  });

  const cells = page.locator('input[inputmode="numeric"]');
  for (let i = 0; i < 6; i++) {
    await cells.nth(i).press(String(i + 1));
  }

  await page.waitForURL(/\/dashboard/, { timeout: 10000 });
  // The dashboard primary CTA greeting
  await expect(page.getByText(/Welcome back/i)).toBeVisible({ timeout: 10000 });
});

test("resend OTP: button is disabled during cooldown, then re-arms", async ({
  page,
}) => {
  await page.goto("/login");
  await page.fill('input[name="identifier"]', "test@example.com");

  await page.route("**/api/auth/send-otp", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        otpId: "otp_cd",
        channel: "email",
        target: "test@example.com",
        display: "te••@example.com",
        cooldownSec: 2,
        hint: null,
        ttlSeconds: 600,
        sentVia: "smtp",
      }),
    });
  });

  await page.getByRole("button", { name: /send 6-digit code/i }).click();
  await expect(
    page.getByRole("heading", { name: /enter the code/i }),
  ).toBeVisible();

  // The resend button shows a countdown
  const resend = page.getByRole("button", { name: /resend in/i });
  await expect(resend).toBeDisabled();

  // After 3s the cooldown expires
  await page.waitForTimeout(3500);
  const resendActive = page.getByRole("button", { name: /resend code/i });
  await expect(resendActive).toBeEnabled();
});
