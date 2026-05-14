import { test, expect } from "@playwright/test";

test.describe("login page (identifier phase)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await expect(
      page.getByRole("heading", { name: /verify yourself/i }),
    ).toBeVisible();
  });

  test("renders both channel tabs with Email selected by default", async ({
    page,
  }) => {
    const email = page.getByRole("tab", { name: /email/i });
    const mobile = page.getByRole("tab", { name: /mobile/i });
    await expect(email).toHaveAttribute("aria-selected", "true");
    await expect(mobile).toHaveAttribute("aria-selected", "false");
  });

  test("switches to Mobile and back", async ({ page }) => {
    const email = page.getByRole("tab", { name: /email/i });
    const mobile = page.getByRole("tab", { name: /mobile/i });

    await mobile.click();
    await expect(mobile).toHaveAttribute("aria-selected", "true");
    await expect(email).toHaveAttribute("aria-selected", "false");

    // The label switches too
    await expect(
      page.getByLabel(/mobile number/i, { exact: false }),
    ).toBeVisible();

    await email.click();
    await expect(email).toHaveAttribute("aria-selected", "true");
    await expect(
      page.getByLabel(/email address/i, { exact: false }),
    ).toBeVisible();
  });

  test("Send button does NOT do a native GET reload (URL must stay /login)", async ({
    page,
  }) => {
    const url = page.url();
    await page.fill('input[name="identifier"]', "harshchinchakar33@gmail.com");

    // Intercept the API call so we don't actually send an email during this test
    await page.route("**/api/auth/send-otp", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          otpId: "otp_test_123",
          channel: "email",
          target: "harshchinchakar33@gmail.com",
          display: "ha•••••••••••••••@gmail.com",
          cooldownSec: 30,
          hint: null,
          ttlSeconds: 600,
          sentVia: "smtp",
        }),
      });
    });

    await page.getByRole("button", { name: /send 6-digit code/i }).click();

    // The URL must remain /login (no `?identifier=...` query string)
    await page.waitForLoadState("networkidle");
    expect(page.url()).toBe(url);
    expect(page.url()).not.toContain("?identifier=");

    // The OTP phase should appear inline
    await expect(
      page.getByRole("heading", { name: /enter the code/i }),
    ).toBeVisible({ timeout: 8000 });
  });

  test("Send with empty field shows inline error and does not navigate", async ({
    page,
  }) => {
    const url = page.url();
    await page.getByRole("button", { name: /send 6-digit code/i }).click();

    await page.waitForTimeout(300);
    expect(page.url()).toBe(url);
    await expect(
      page.getByText(/please enter your email address/i),
    ).toBeVisible();
  });

  test("Mobile flow: switch, type, send → OTP phase appears", async ({
    page,
  }) => {
    await page.getByRole("tab", { name: /mobile/i }).click();
    await page.fill('input[name="identifier"]', "9876543210");

    await page.route("**/api/auth/send-otp", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          otpId: "otp_mobile_test",
          channel: "mobile",
          target: "9876543210",
          display: "+91 98••• 210",
          cooldownSec: 30,
          hint: "Mobile OTPs forwarded to platform email for the demo.",
          ttlSeconds: 600,
          sentVia: "smtp",
        }),
      });
    });

    await page.getByRole("button", { name: /send 6-digit code/i }).click();
    await expect(
      page.getByRole("heading", { name: /enter the code/i }),
    ).toBeVisible({ timeout: 8000 });
    await expect(page.getByText(/\+91 98••• 210/)).toBeVisible();
  });
});
