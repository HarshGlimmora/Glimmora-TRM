/**
 * Floating Glimmora Assistant — visual + suppression checks.
 *
 * Verifies:
 *   - the FAB is rendered, visible, and pinned to the bottom-right on every
 *     non-sensitive authenticated screen (dashboard, connections, filings/new),
 *   - the FAB stays mounted across route transitions (no re-mount flash),
 *   - the FAB is suppressed on sensitive screens (auth, onboarding, OTP verify),
 *   - clicking the FAB opens a panel pinned to the bottom-right.
 *
 * Auth + workspace endpoints are mocked so the test doesn't need real OTP /
 * session state. Screenshots are saved to test-results/ for visual review.
 */
import { expect, test, type Page } from "@playwright/test";

const TAXPAYER_ME = {
  authenticated: true,
  next: "/dashboard",
  hasProfile: true,
  rememberMe: false,
  user: {
    id: "usr_tp_assistant",
    role: "taxpayer" as const,
    email: "assistant-taxpayer@glimmora.test",
    phone: null,
    displayName: "Demo Taxpayer",
    legalName: "Demo Taxpayer",
    emailVerified: true,
    phoneVerified: false,
    profileCompletedAt: new Date().toISOString(),
  },
  onboarding: null,
};

async function mockAuthedTaxpayer(page: Page) {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(TAXPAYER_ME),
    }),
  );
  // Stub out anything the app might call during render so we don't spend the
  // test waiting on real network.
  await page.route("**/api/consultants/directory", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ consultants: [] }) }),
  );
  await page.route("**/api/ca-link", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ grants: [] }) }),
  );
  await page.route("**/api/chat/threads", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ threads: [] }) }),
  );
  await page.route("**/api/workspace/years", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ years: [] }) }),
  );
}

async function expectFabPinnedBottomRight(page: Page, label: string) {
  const fab = page.getByTestId("assistant-fab");
  await expect(fab, `FAB should be present on ${label}`).toBeVisible();

  const box = await fab.boundingBox();
  const vw = page.viewportSize();
  expect(box, `FAB bounding box on ${label}`).not.toBeNull();
  expect(vw, "viewport size").not.toBeNull();
  if (!box || !vw) return;

  // Right anchor: the FAB's right edge should sit ~24px from the viewport right.
  const rightGap = vw.width - (box.x + box.width);
  expect(rightGap, `FAB right gap on ${label}`).toBeGreaterThan(8);
  expect(rightGap, `FAB right gap on ${label}`).toBeLessThan(56);

  // Bottom anchor: same idea on the y axis.
  const bottomGap = vw.height - (box.y + box.height);
  expect(bottomGap, `FAB bottom gap on ${label}`).toBeGreaterThan(8);
  expect(bottomGap, `FAB bottom gap on ${label}`).toBeLessThan(56);
}

test.describe("Floating assistant", () => {
  test("FAB is visible and pinned bottom-right across authenticated pages", async ({ page }) => {
    await mockAuthedTaxpayer(page);

    // Dashboard
    await page.goto("/dashboard");
    await page.waitForURL(/\/dashboard$/);
    await expectFabPinnedBottomRight(page, "/dashboard");
    await page.screenshot({ path: "test-results/assistant-dashboard.png", fullPage: false });

    // Connections
    await page.goto("/connections");
    await page.waitForURL(/\/connections$/);
    await expectFabPinnedBottomRight(page, "/connections");
    await page.screenshot({ path: "test-results/assistant-connections.png", fullPage: false });

    // New filing
    await page.goto("/filings/new");
    await page.waitForURL(/\/filings\/new$/);
    await expectFabPinnedBottomRight(page, "/filings/new");
    await page.screenshot({ path: "test-results/assistant-filings-new.png", fullPage: false });
  });

  test("FAB stays mounted across in-app navigations (no flash)", async ({ page }) => {
    await mockAuthedTaxpayer(page);
    await page.goto("/dashboard");
    await page.waitForURL(/\/dashboard$/);

    const fab = page.getByTestId("assistant-fab");
    await expect(fab).toBeVisible();

    // Tag the live FAB node so we can prove it survives a same-layout,
    // client-side navigation (not a hard reload — that's expected to remount).
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="assistant-fab"]');
      if (el) el.setAttribute("data-mount-marker", "persisted");
    });

    // The TopBar exposes a real in-app link to Connections. Clicking it goes
    // through Next.js's client router — the (app) layout (and the Assistant
    // mounted inside it) must NOT remount.
    await page.getByRole("link", { name: /Connections/i }).first().click();
    await page.waitForURL(/\/connections$/);
    await expect(fab).toBeVisible();

    const stillThere = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="assistant-fab"]');
      return el?.getAttribute("data-mount-marker") === "persisted";
    });
    expect(stillThere, "FAB should persist across in-app navigation").toBeTruthy();
  });

  test("FAB is suppressed on sensitive screens", async ({ page }) => {
    // Login is unauthenticated — assistant is in the (app) group, not the
    // (auth) group, so it's not even rendered. Still verify behavior is
    // correct (no FAB visible).
    await page.goto("/login");
    await expect(page.getByTestId("assistant-fab")).toHaveCount(0);

    // /verify is sensitive even if the user lands there mid-auth — suppress.
    await page.goto("/verify");
    await expect(page.getByTestId("assistant-fab")).toHaveCount(0);

    // Onboarding screens collect PAN/Aadhaar → assistant must stay hidden.
    await mockAuthedTaxpayer(page);
    await page.route("**/api/onboarding/progress", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ step: 0 }) }),
    );
    await page.goto("/onboarding/taxpayer");
    // Onboarding lives outside the (app) group — the assistant is never
    // mounted here. Use count() rather than toBeHidden() because the element
    // truly is absent from the DOM.
    await expect(page.getByTestId("assistant-fab")).toHaveCount(0);
  });

  test("Clicking the FAB opens a panel pinned bottom-right", async ({ page }) => {
    await mockAuthedTaxpayer(page);
    await page.route("**/api/assistant/answer", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          answer: "The Overview gives you a single snapshot of your account.",
          citation: "Dashboard › Overview",
          kind: "answer",
          page: { id: "dashboard", label: "Overview", section: "Dashboard" },
          suggestions: ["Explain this screen", "What should I do next?"],
        }),
      }),
    );

    await page.goto("/dashboard");
    await page.waitForURL(/\/dashboard$/);
    await page.getByTestId("assistant-fab").click();

    const panel = page.getByTestId("assistant-panel");
    await expect(panel).toBeVisible();
    await page.screenshot({ path: "test-results/assistant-open.png", fullPage: false });

    const box = await panel.boundingBox();
    const vw = page.viewportSize();
    expect(box).not.toBeNull();
    expect(vw).not.toBeNull();
    if (box && vw) {
      const rightGap = vw.width - (box.x + box.width);
      expect(rightGap).toBeGreaterThan(8);
      expect(rightGap).toBeLessThan(56);
    }

    // Ask a question, expect the mocked answer to appear with its citation.
    await panel.getByPlaceholder(/Ask about overview/i).fill("Explain this screen");
    await panel.getByRole("button", { name: "Send" }).click();
    await expect(panel.getByText(/The Overview gives you a single snapshot/)).toBeVisible();
    await expect(panel.getByText(/Source · Dashboard › Overview/)).toBeVisible();
    await page.screenshot({ path: "test-results/assistant-answered.png", fullPage: false });
  });
});
