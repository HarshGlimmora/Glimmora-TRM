/**
 * Chat overlay — taxpayer view.
 *
 * Exercises the end-to-end UI contract for the Connections-page chat:
 *   - Active Chats card lists existing threads and opens the drawer
 *   - Active Connections card opens a thread for a connected CA
 *   - Send a text message → POST /api/chat/threads/[id]/messages
 *   - Attach a file → POST /api/chat/threads/[id]/attachments
 *   - Toggle a reaction → POST /api/chat/messages/[id]/reactions
 *
 * The API layer is intercepted so the test doesn't need the embedded
 * PGlite to be in any particular state — the server-side schema is
 * already covered by repo/service tests we can add later if needed.
 */
import { expect, test, type Page, type Route } from "@playwright/test";

const TAXPAYER_ME = {
  authenticated: true,
  next: "/dashboard",
  hasProfile: true,
  rememberMe: false,
  user: {
    id: "usr_tp_chat",
    role: "taxpayer" as const,
    email: "chat-taxpayer@glimmora.test",
    phone: null,
    displayName: "Demo Taxpayer",
    legalName: "Demo Taxpayer",
    emailVerified: true,
    phoneVerified: false,
    profileCompletedAt: new Date().toISOString(),
  },
  onboarding: null,
};

const CONSULTANT_ID = "ca_999";
const THREAD_ID = "thr_abc";
const NOW = new Date().toISOString();

function makeThread(opts?: { unread?: boolean; preview?: string | null }) {
  return {
    id: THREAD_ID,
    consultantId: CONSULTANT_ID,
    taxpayerId: TAXPAYER_ME.user.id,
    counterpartyId: CONSULTANT_ID,
    counterpartyName: "CA Grace Hopper",
    counterpartyRole: "consultant" as const,
    myRole: "taxpayer" as const,
    lastMessageAt: opts?.preview === null ? null : NOW,
    lastMessagePreview: opts?.preview === null ? null : opts?.preview ?? "Hello there",
    lastMessageMine: false,
    hasAttachment: false,
    unread: opts?.unread ?? false,
    createdAt: NOW,
  };
}

function makeGrant() {
  return {
    id: "grant_xyz",
    consultantId: CONSULTANT_ID,
    taxpayerId: TAXPAYER_ME.user.id,
    counterpartyName: "CA Grace Hopper",
    counterpartyPan: null,
    myRoleInGrant: "taxpayer",
    accessMode: "review_edit",
    status: "active",
    taxYears: ["FY 2024-25"],
    origin: "directory_request",
    requestedBy: "taxpayer",
    requestedAt: NOW,
    respondedAt: NOW,
    expiresAt: null,
    revokedAt: null,
    message: null,
  };
}

async function mockShared(page: Page) {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(TAXPAYER_ME),
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

test.describe("Chat — taxpayer", () => {
  test("Active Chats lists threads and opens the drawer on click", async ({ page }) => {
    await mockShared(page);
    await page.route("**/api/ca-link", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ grants: [] }),
      }),
    );
    await page.route("**/api/chat/threads", (route, req) => {
      if (req.method() === "GET") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            threads: [makeThread({ unread: true, preview: "Got your return draft." })],
          }),
        });
      }
      return route.fulfill({ status: 405, body: "" });
    });
    await page.route(`**/api/chat/threads/${THREAD_ID}/messages**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          messages: [
            {
              id: "msg_1",
              threadId: THREAD_ID,
              senderId: CONSULTANT_ID,
              mine: false,
              body: "Got your return draft.",
              createdAt: NOW,
              attachments: [],
              reactions: [],
            },
          ],
        }),
      }),
    );
    await page.route(`**/api/chat/threads/${THREAD_ID}/read`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      }),
    );

    await page.goto("/connections");
    await page.waitForURL(/\/connections$/);

    const activeChats = page.getByRole("region", { name: /^active chats$/i });
    await expect(activeChats).toBeVisible();
    await expect(activeChats.getByText("CA Grace Hopper")).toBeVisible();
    await expect(activeChats.getByText(/Got your return draft\./i)).toBeVisible();

    await activeChats.getByRole("button", { name: /CA Grace Hopper/i }).click();

    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    await expect(
      drawer.getByRole("heading", { name: /CA Grace Hopper/i }),
    ).toBeVisible();
    await expect(drawer.getByText(/Got your return draft\./i)).toBeVisible();
  });

  test("Active Connections → Chat button opens a thread via /api/chat/threads (POST)", async ({
    page,
  }) => {
    await mockShared(page);
    await page.route("**/api/ca-link", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ grants: [makeGrant()] }),
      }),
    );
    await page.route("**/api/chat/threads", (route, req) => {
      if (req.method() === "GET") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ threads: [] }),
        });
      }
      const body = JSON.parse(req.postData() ?? "{}");
      expect(body).toMatchObject({ counterpartyId: CONSULTANT_ID });
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          thread: { id: THREAD_ID, consultantId: CONSULTANT_ID, taxpayerId: TAXPAYER_ME.user.id },
        }),
      });
    });
    await page.route(`**/api/chat/threads/${THREAD_ID}/messages**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ messages: [] }),
      }),
    );
    await page.route(`**/api/chat/threads/${THREAD_ID}/read`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      }),
    );

    await page.goto("/connections");
    await page.waitForURL(/\/connections$/);

    const activeConnections = page.getByRole("region", {
      name: /^active connections$/i,
    });
    await expect(activeConnections).toBeVisible();
    await activeConnections.getByRole("button", { name: /chat/i }).click();

    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText(/No messages yet/i)).toBeVisible();
  });

  test("send a text message POSTs to /api/chat/threads/[id]/messages", async ({
    page,
  }) => {
    await mockShared(page);
    await page.route("**/api/ca-link", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ grants: [] }),
      }),
    );
    await page.route("**/api/chat/threads", (route, req) => {
      if (req.method() === "GET") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            threads: [makeThread({ preview: null })],
          }),
        });
      }
      return route.fulfill({ status: 405, body: "" });
    });

    let getCount = 0;
    await page.route(`**/api/chat/threads/${THREAD_ID}/messages**`, (route, req) => {
      if (req.method() === "GET") {
        getCount += 1;
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ messages: [] }),
        });
      }
      const body = JSON.parse(req.postData() ?? "{}");
      expect(body).toMatchObject({ body: "Hello CA" });
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          message: {
            id: "msg_new",
            threadId: THREAD_ID,
            senderId: TAXPAYER_ME.user.id,
            mine: true,
            body: "Hello CA",
            createdAt: new Date().toISOString(),
            attachments: [],
            reactions: [],
          },
        }),
      });
    });
    await page.route(`**/api/chat/threads/${THREAD_ID}/read`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      }),
    );

    await page.goto("/connections");
    await page.waitForURL(/\/connections$/);

    const activeChats = page.getByRole("region", { name: /^active chats$/i });
    await activeChats.getByRole("button", { name: /CA Grace Hopper/i }).click();

    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    await drawer.getByPlaceholder(/type a message/i).fill("Hello CA");
    await drawer.getByRole("button", { name: /^send$/i }).click();

    await expect(drawer.getByText("Hello CA")).toBeVisible({ timeout: 5000 });
    expect(getCount).toBeGreaterThan(0);
  });

  test("attach a file POSTs to /api/chat/threads/[id]/attachments (multipart)", async ({
    page,
  }) => {
    await mockShared(page);
    await page.route("**/api/ca-link", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ grants: [] }),
      }),
    );
    await page.route("**/api/chat/threads", (route, req) => {
      if (req.method() === "GET") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ threads: [makeThread({ preview: null })] }),
        });
      }
      return route.fulfill({ status: 405, body: "" });
    });
    await page.route(`**/api/chat/threads/${THREAD_ID}/messages**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ messages: [] }),
      }),
    );
    await page.route(`**/api/chat/threads/${THREAD_ID}/read`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      }),
    );
    let captured: { ct: string | null; body: Buffer | null } = { ct: null, body: null };
    await page.route(
      `**/api/chat/threads/${THREAD_ID}/attachments`,
      (route: Route, req) => {
        captured = {
          ct: req.headers()["content-type"] ?? null,
          body: req.postDataBuffer(),
        };
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            message: {
              id: "msg_attach",
              threadId: THREAD_ID,
              senderId: TAXPAYER_ME.user.id,
              mine: true,
              body: null,
              createdAt: new Date().toISOString(),
              attachments: [
                {
                  id: "att_1",
                  fileName: "form16.pdf",
                  mimeType: "application/pdf",
                  byteSize: 11,
                  downloadUrl: "/api/chat/attachments/att_1/download",
                },
              ],
              reactions: [],
            },
          }),
        });
      },
    );

    await page.goto("/connections");
    await page.waitForURL(/\/connections$/);

    const activeChats = page.getByRole("region", { name: /^active chats$/i });
    await activeChats.getByRole("button", { name: /CA Grace Hopper/i }).click();

    const drawer = page.getByRole("dialog");
    const fileInput = drawer.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: "form16.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("hello world"),
    });

    await expect(drawer.getByText("form16.pdf")).toBeVisible({ timeout: 5000 });
    expect(captured.ct).toContain("multipart/form-data");
  });

  test("toggle a reaction POSTs to /api/chat/messages/[id]/reactions", async ({
    page,
  }) => {
    await mockShared(page);
    await page.route("**/api/ca-link", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ grants: [] }),
      }),
    );
    await page.route("**/api/chat/threads", (route, req) => {
      if (req.method() === "GET") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ threads: [makeThread({ preview: null })] }),
        });
      }
      return route.fulfill({ status: 405, body: "" });
    });
    await page.route(`**/api/chat/threads/${THREAD_ID}/messages**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          messages: [
            {
              id: "msg_react",
              threadId: THREAD_ID,
              senderId: CONSULTANT_ID,
              mine: false,
              body: "Please review",
              createdAt: NOW,
              attachments: [],
              reactions: [],
            },
          ],
        }),
      }),
    );
    await page.route(`**/api/chat/threads/${THREAD_ID}/read`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      }),
    );

    let captured: Record<string, unknown> | null = null;
    await page.route("**/api/chat/messages/msg_react/reactions", (route, req) => {
      captured = JSON.parse(req.postData() ?? "{}");
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ added: true }),
      });
    });

    await page.goto("/connections");
    await page.waitForURL(/\/connections$/);
    const activeChats = page.getByRole("region", { name: /^active chats$/i });
    await activeChats.getByRole("button", { name: /CA Grace Hopper/i }).click();

    const drawer = page.getByRole("dialog");
    await expect(drawer.getByText("Please review")).toBeVisible();

    // The reaction row is hidden until hover/focus — `force` lets the test
    // click it without simulating mouse movement.
    await drawer.getByRole("button", { name: /react heart/i }).click({ force: true });

    await expect.poll(() => captured).not.toBeNull();
    expect(captured).toMatchObject({ emoji: "heart" });
  });
});
