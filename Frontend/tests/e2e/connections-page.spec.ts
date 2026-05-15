/**
 * /connections page — taxpayer view.
 *
 * Covers:
 *   1. The page renders for an authenticated taxpayer (regression guard for
 *      the AuthGuard bug that bounced everyone back to /dashboard).
 *   2. The right-side area shows BOTH Active Chats and Active Connections
 *      cards (the Connect-via-code block was replaced).
 *   3. Browse Consultants → Connect still wires to /api/ca-link/by-id.
 *   4. Link by PAN modal opens and validates PAN format.
 *
 * Auth is mocked at /api/auth/me — same pattern as full-flow.spec.ts.
 */
import { expect, test, type Page } from "@playwright/test";

const TAXPAYER_ME = {
  authenticated: true,
  next: "/dashboard",
  hasProfile: true,
  rememberMe: false,
  user: {
    id: "usr_taxpayer_pw",
    role: "taxpayer" as const,
    email: "pwtest-taxpayer@glimmora.test",
    phone: null,
    displayName: "Demo Taxpayer",
    legalName: "Demo Taxpayer",
    emailVerified: true,
    phoneVerified: false,
    profileCompletedAt: new Date().toISOString(),
  },
  onboarding: null,
};

async function mockBaseTaxpayer(page: Page) {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(TAXPAYER_ME),
    }),
  );
  await page.route("**/api/ca-link", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ grants: [] }),
    }),
  );
  await page.route("**/api/consultants/directory", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ consultants: [] }),
    }),
  );
  await page.route("**/api/chat/threads", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ threads: [] }),
    }),
  );
}

test.describe("/connections — taxpayer", () => {
  test("renders for an authenticated taxpayer (does NOT redirect to /dashboard)", async ({
    page,
  }) => {
    await mockBaseTaxpayer(page);
    await page.goto("/connections");

    // Regression guard: AuthGuard used to redirect any completed-profile
    // user back to /dashboard regardless of intent.
    await page.waitForURL(/\/connections$/, { timeout: 8000 });
    expect(page.url()).toMatch(/\/connections$/);

    await expect(
      page.getByRole("heading", { name: /your consultants & access grants/i }),
    ).toBeVisible();

    // Top-right action is still the PAN link entrypoint.
    await expect(page.getByRole("button", { name: /link by pan/i })).toBeVisible();

    // Right-side panel now hosts both chat cards.
    await expect(
      page.getByRole("region", { name: /^active chats$/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: /^active connections$/i }),
    ).toBeVisible();

    // Browse consultants (left panel) is unchanged.
    await expect(
      page.getByRole("region", { name: /browse consultants/i }),
    ).toBeVisible();

    // The legacy "Connect via code" panel must be gone.
    await expect(
      page.getByRole("region", { name: /connect via code/i }),
    ).toHaveCount(0);

    // Empty-state copy for server-driven and pending lists still renders.
    await expect(page.getByText(/no pending requests/i)).toBeVisible();
  });

  test("Browse consultants → clicking Connect POSTs to /api/ca-link/by-id", async ({
    page,
  }) => {
    await mockBaseTaxpayer(page);
    await page.unroute("**/api/consultants/directory");
    await page.route("**/api/consultants/directory", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          consultants: [
            {
              id: "ca_001",
              displayName: "CA Ada Lovelace",
              firmName: "Lovelace & Co.",
              city: "Bengaluru",
              state: "KA",
              specializations: ["individual_itr"],
              yearsExperience: 8,
              acceptingClients: true,
            },
          ],
        }),
      }),
    );

    let postedTo: string | null = null;
    let postedBody: Record<string, unknown> | null = null;
    await page.route("**/api/ca-link/by-id", async (route, req) => {
      postedTo = req.url();
      postedBody = JSON.parse(req.postData() ?? "{}");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          grant: {
            id: "grant_pw_001",
            consultantId: "ca_001",
            taxpayerId: TAXPAYER_ME.user.id,
            counterpartyName: "CA Ada Lovelace",
            counterpartyPan: null,
            myRoleInGrant: "taxpayer",
            accessMode: "review_edit",
            status: "pending",
            taxYears: ["FY 2024-25"],
            origin: "directory_request",
            requestedBy: "taxpayer",
            requestedAt: new Date().toISOString(),
            respondedAt: null,
            expiresAt: null,
            revokedAt: null,
            message: null,
          },
        }),
      });
    });

    await page.goto("/connections");
    await page.waitForURL(/\/connections$/);

    await expect(page.getByText("CA Ada Lovelace")).toBeVisible();

    const browsePanel = page.getByRole("region", { name: /browse consultants/i });
    await browsePanel.getByRole("button", { name: /^connect$/i }).click();

    await expect(page.getByText(/Request sent to CA Ada Lovelace/i)).toBeVisible({
      timeout: 5000,
    });

    expect(postedTo).toContain("/api/ca-link/by-id");
    expect(postedBody).toMatchObject({ consultantId: "ca_001" });
  });

  test("Link by PAN modal opens and validates the PAN format", async ({ page }) => {
    await mockBaseTaxpayer(page);
    await page.goto("/connections");
    await page.waitForURL(/\/connections$/);

    await page.getByRole("button", { name: /link by pan/i }).click();

    await expect(
      page.getByRole("heading", { name: /link a chartered accountant/i }),
    ).toBeVisible();

    const send = page.getByRole("button", { name: /send request/i });
    await expect(send).toBeDisabled();

    // 4th char must be a recognised entity code (P = Individual).
    await page.getByLabel(/consultant pan/i).fill("ABCPE1234F");
    await expect(send).toBeEnabled();
  });
});
