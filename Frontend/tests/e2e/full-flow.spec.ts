import { test, expect } from "@playwright/test";

/**
 * Full /login → OTP → next flow.
 *
 * The OTP send/verify + /me lookup are intercepted with deterministic
 * responses so this test doesn't depend on email delivery or a live DB.
 * The shapes mirror the real /api/auth/* contract — if anything changes
 * there, this test breaks (which is the point).
 */

function mockMe(role: "taxpayer" | "consultant" | null, hasProfile: boolean) {
  return {
    authenticated: true,
    next: hasProfile ? "/dashboard" : role ? `/onboarding/${role}?step=0` : "/role-select",
    hasProfile,
    rememberMe: false,
    user: {
      id: "usr_mock",
      role,
      email: "newuser@example.in",
      phone: null,
      displayName: hasProfile ? "Demo Taxpayer" : null,
      legalName: null,
      emailVerified: true,
      phoneVerified: false,
      profileCompletedAt: hasProfile ? new Date().toISOString() : null,
    },
  };
}

test("complete flow: login → OTP → role-select", async ({ page }) => {
  await page.goto("/login");

  await expect(
    page.getByRole("heading", { name: /verify yourself/i }),
  ).toBeVisible();

  const mobileTab = page.getByRole("tab", { name: /mobile/i });
  const emailTab = page.getByRole("tab", { name: /email/i });
  await mobileTab.click();
  await expect(mobileTab).toHaveAttribute("aria-selected", "true");
  await emailTab.click();
  await expect(emailTab).toHaveAttribute("aria-selected", "true");

  await page.fill('input[name="identifier"]', "newuser@example.in");

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
  await page.waitForTimeout(800);
  expect(page.url()).toBe(urlBefore);

  await expect(
    page.getByRole("heading", { name: /enter the code/i }),
  ).toBeVisible();
  await expect(page.getByText(/ne••••••@example.in/)).toBeVisible();

  const cells = page.locator('input[inputmode="numeric"]');
  await expect(cells).toHaveCount(6);

  // Verify: new user → next=/role-select
  await page.route("**/api/auth/verify-otp", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        next: "/role-select",
        hasProfile: false,
        user: mockMe(null, false).user,
      }),
    });
  });
  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockMe(null, false)),
    });
  });

  for (let i = 0; i < 6; i++) {
    await cells.nth(i).press(String(i + 1));
  }

  await page.waitForURL(/\/role-select/, { timeout: 8000 });
  await expect(page.getByText(/Choose your role/i)).toBeVisible();
});

test("returning user: OTP verify routes straight to /dashboard", async ({ page }) => {
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
        next: "/dashboard",
        hasProfile: true,
        user: mockMe("taxpayer", true).user,
      }),
    });
  });
  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockMe("taxpayer", true)),
    });
  });

  const cells = page.locator('input[inputmode="numeric"]');
  for (let i = 0; i < 6; i++) {
    await cells.nth(i).press(String(i + 1));
  }

  await page.waitForURL(/\/dashboard/, { timeout: 10000 });
});

test("resend OTP: button is disabled during cooldown, then re-arms", async ({ page }) => {
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

  const resend = page.getByRole("button", { name: /resend in/i });
  await expect(resend).toBeDisabled();

  await page.waitForTimeout(3500);
  const resendActive = page.getByRole("button", { name: /resend code/i });
  await expect(resendActive).toBeEnabled();
});

test("remember-me checkbox sends rememberMe:true to verify-otp", async ({ page }) => {
  await page.goto("/login");
  await page.fill('input[name="identifier"]', "remember@example.in");

  await page.route("**/api/auth/send-otp", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        otpId: "otp_remember",
        channel: "email",
        target: "remember@example.in",
        display: "re•••••@example.in",
        cooldownSec: 30,
        hint: null,
        ttlSeconds: 600,
        sentVia: "smtp",
      }),
    });
  });

  // Tick the remember-me checkbox before sending.
  await page.getByLabel(/Remember me on this device/i).check();
  await page.getByRole("button", { name: /send 6-digit code/i }).click();

  let capturedBody: Record<string, unknown> | null = null;
  await page.route("**/api/auth/verify-otp", async (route, req) => {
    capturedBody = JSON.parse(req.postData() ?? "{}");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        next: "/role-select",
        hasProfile: false,
        user: mockMe(null, false).user,
      }),
    });
  });
  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockMe(null, false)),
    });
  });

  const cells = page.locator('input[inputmode="numeric"]');
  for (let i = 0; i < 6; i++) {
    await cells.nth(i).press(String(i + 1));
  }
  await page.waitForURL(/\/role-select/, { timeout: 8000 });

  expect(capturedBody).toMatchObject({ rememberMe: true });
});
