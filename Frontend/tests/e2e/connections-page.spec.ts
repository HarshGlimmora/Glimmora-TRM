/**
 * /connections page — taxpayer flow.
 *
 * Reproduces the bug where /connections redirected to /dashboard, then
 * verifies the page now renders for an authenticated taxpayer and that the
 * three "Link a consultant" sub-flows are present and wired up:
 *
 *   1. Browse consultants  (directory + 1-click connect)
 *   2. Connect via 5-digit invite code
 *   3. Link by PAN modal
 *
 * Auth is mocked at /api/auth/me — same pattern used by full-flow.spec.ts.
 * The connections-specific APIs (/api/ca-link/*, /api/consultants/*) are
 * intercepted with deterministic payloads so the test doesn't need a live
 * DB. The intent is to lock in the rendering + click contracts; deeper API
 * coverage already lives in api-auth.spec.ts.
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

async function mockAuthAndEmptyConnections(page: Page) {
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
}

test.describe("/connections — taxpayer", () => {
  test("renders for an authenticated taxpayer (does NOT redirect to /dashboard)", async ({
    page,
  }) => {
    await mockAuthAndEmptyConnections(page);
    await page.goto("/connections");

    // The bug we just fixed: AuthGuard would bounce us to /dashboard because
    // the server's "next" hint is always /dashboard for completed profiles.
    await page.waitForURL(/\/connections$/, { timeout: 8000 });
    expect(page.url()).toMatch(/\/connections$/);

    await expect(
      page.getByRole("heading", { name: /your consultants & access grants/i }),
    ).toBeVisible();

    // The three "link a consultant" entry points must all be present.
    await expect(page.getByRole("region", { name: /browse consultants/i })).toBeVisible();
    await expect(page.getByRole("region", { name: /connect via code/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /link by pan/i })).toBeVisible();

    // Empty-state copy for both server-driven and pending lists.
    await expect(page.getByText(/no pending requests/i)).toBeVisible();
    await expect(page.getByText(/no active connections yet/i)).toBeVisible();
  });

  test("Browse consultants → clicking Connect POSTs to /api/ca-link/by-id", async ({
    page,
  }) => {
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

    // Card renders.
    await expect(page.getByText("CA Ada Lovelace")).toBeVisible();

    // Click the Connect button inside the Browse panel (the Code panel
    // also has a "Connect" button, so we scope to the right region).
    const browsePanel = page.getByRole("region", { name: /browse consultants/i });
    await browsePanel.getByRole("button", { name: /^connect$/i }).click();

    // Success toast (Alert) from the parent's onConnected callback.
    await expect(page.getByText(/Request sent to CA Ada Lovelace/i)).toBeVisible({
      timeout: 5000,
    });

    expect(postedTo).toContain("/api/ca-link/by-id");
    expect(postedBody).toMatchObject({ consultantId: "ca_001" });
  });

  test("Connect via code → submits to /api/ca-link/by-code and shows success", async ({
    page,
  }) => {
    await mockAuthAndEmptyConnections(page);

    let postedBody: Record<string, unknown> | null = null;
    await page.route("**/api/ca-link/by-code", async (route, req) => {
      postedBody = JSON.parse(req.postData() ?? "{}");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          grant: {
            id: "grant_pw_code",
            consultantId: "ca_002",
            taxpayerId: TAXPAYER_ME.user.id,
            counterpartyName: "CA Grace Hopper",
            counterpartyPan: null,
            myRoleInGrant: "taxpayer",
            accessMode: "review_edit",
            status: "active",
            taxYears: ["FY 2024-25"],
            origin: "invite_code",
            requestedBy: "taxpayer",
            requestedAt: new Date().toISOString(),
            respondedAt: new Date().toISOString(),
            expiresAt: null,
            revokedAt: null,
            message: null,
          },
          consultantId: "ca_002",
        }),
      });
    });

    await page.goto("/connections");
    await page.waitForURL(/\/connections$/);

    const code = page.getByLabel(/invite code/i);
    await code.fill("12345");

    // The Connect button inside the code panel.
    const codePanel = page.getByRole("region", { name: /connect via code/i });
    await codePanel.getByRole("button", { name: /^connect$/i }).click();

    // Parent page raises its own toast — match the parent's wording so we
    // don't collide with the panel's local success copy.
    await expect(
      page.getByText(/Your consultant now has the agreed scope/i),
    ).toBeVisible({ timeout: 5000 });
    expect(postedBody).toMatchObject({ code: "12345" });
  });

  test("Link by PAN modal opens and validates the PAN format", async ({ page }) => {
    await mockAuthAndEmptyConnections(page);
    await page.goto("/connections");
    await page.waitForURL(/\/connections$/);

    await page.getByRole("button", { name: /link by pan/i }).click();

    await expect(
      page.getByRole("heading", { name: /link a chartered accountant/i }),
    ).toBeVisible();

    const send = page.getByRole("button", { name: /send request/i });
    await expect(send).toBeDisabled();

    // Type a complete, well-formed PAN — Send becomes enabled.
    // 4th char must be a recognised entity code (P = Individual).
    await page.getByLabel(/consultant pan/i).fill("ABCPE1234F");
    await expect(send).toBeEnabled();
  });
});
