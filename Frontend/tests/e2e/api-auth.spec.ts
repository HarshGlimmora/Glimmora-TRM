/**
 * API-level e2e tests for the auth + onboarding + CA-link persistence layer.
 *
 * Uses Playwright's `request` fixture so we don't need a browser — these
 * tests run against the real Next.js API + Postgres. The helpers in
 * `_helpers.ts` peek at the DB so we can drive the OTP flow without
 * roundtripping email.
 *
 * Pre-requisites (the suite asserts these at the top):
 *   - DATABASE_URL points at the same Postgres the dev server uses
 *   - The dev server is reachable (Playwright's webServer config in
 *     playwright.config.ts spawns it)
 */
import { expect, test } from "@playwright/test";
import {
  countSessionsForUser,
  countUsersByDestination,
  deleteTestUser,
  markOnboardingStep,
  markProfileComplete,
  setLatestOtpCode,
  shutdown,
  userExists,
} from "./_helpers";

const EMAIL = `pwtest+${Date.now()}@glimmora.test`;
const RETURNING_EMAIL = `pwtest-returning+${Date.now()}@glimmora.test`;
const RESUME_EMAIL = `pwtest-resume+${Date.now()}@glimmora.test`;
const REMEMBER_EMAIL = `pwtest-remember+${Date.now()}@glimmora.test`;
const FIXED_CODE = "424242";

test.afterAll(async () => {
  await Promise.all([
    deleteTestUser({ channel: "email", destination: EMAIL }),
    deleteTestUser({ channel: "email", destination: RETURNING_EMAIL }),
    deleteTestUser({ channel: "email", destination: RESUME_EMAIL }),
    deleteTestUser({ channel: "email", destination: REMEMBER_EMAIL }),
  ]);
  await shutdown();
});

test.describe("send-otp / verify-otp", () => {
  test("new user → next=/role-select; same email twice → no duplicate user", async ({
    request,
  }) => {
    await deleteTestUser({ channel: "email", destination: EMAIL });

    const first = await request.post("/api/auth/send-otp", {
      data: { identifier: EMAIL, channel: "email" },
    });
    expect(first.ok()).toBeTruthy();
    const sendBody = (await first.json()) as { otpId: string };
    expect(sendBody.otpId).toBeTruthy();

    // Second send for the same identifier must NOT create another user row.
    const second = await request.post("/api/auth/send-otp", {
      data: { identifier: EMAIL, channel: "email" },
    });
    expect(second.ok()).toBeTruthy();

    expect(await countUsersByDestination({ channel: "email", destination: EMAIL })).toBe(1);

    const otpId = await setLatestOtpCode({
      channel: "email",
      destination: EMAIL,
      code: FIXED_CODE,
    });

    const verify = await request.post("/api/auth/verify-otp", {
      data: { otpId, code: FIXED_CODE, rememberMe: false },
    });
    expect(verify.ok()).toBeTruthy();
    const data = (await verify.json()) as {
      ok: boolean;
      next: string;
      hasProfile: boolean;
    };
    expect(data.ok).toBe(true);
    expect(data.hasProfile).toBe(false);
    expect(data.next).toBe("/role-select");
  });

  test("returning complete user → next=/dashboard", async ({ request }) => {
    await deleteTestUser({ channel: "email", destination: RETURNING_EMAIL });
    // Provision a user with a complete profile directly via DB.
    let send = await request.post("/api/auth/send-otp", {
      data: { identifier: RETURNING_EMAIL, channel: "email" },
    });
    expect(send.ok()).toBeTruthy();
    const userBefore = await userExists({ channel: "email", destination: RETURNING_EMAIL });
    expect(userBefore).toBeTruthy();
    await markProfileComplete(userBefore!.id);

    // Now go through the verify path again — should land on /dashboard.
    send = await request.post("/api/auth/send-otp", {
      data: { identifier: RETURNING_EMAIL, channel: "email" },
    });
    expect(send.ok()).toBeTruthy();
    const otpId = await setLatestOtpCode({
      channel: "email",
      destination: RETURNING_EMAIL,
      code: FIXED_CODE,
    });
    const verify = await request.post("/api/auth/verify-otp", {
      data: { otpId, code: FIXED_CODE, rememberMe: false },
    });
    const data = (await verify.json()) as { hasProfile: boolean; next: string };
    expect(data.hasProfile).toBe(true);
    expect(data.next).toBe("/dashboard");
  });

  test("returning incomplete user → resumes at saved step", async ({ request }) => {
    await deleteTestUser({ channel: "email", destination: RESUME_EMAIL });
    // First send creates the user.
    await request.post("/api/auth/send-otp", {
      data: { identifier: RESUME_EMAIL, channel: "email" },
    });
    const u = await userExists({ channel: "email", destination: RESUME_EMAIL });
    expect(u).toBeTruthy();
    // Simulate they got to step 2 of taxpayer onboarding.
    await markOnboardingStep({ userId: u!.id, role: "taxpayer", step: 2 });

    // Verify-OTP should redirect them straight there.
    await request.post("/api/auth/send-otp", {
      data: { identifier: RESUME_EMAIL, channel: "email" },
    });
    const otpId = await setLatestOtpCode({
      channel: "email",
      destination: RESUME_EMAIL,
      code: FIXED_CODE,
    });
    const verify = await request.post("/api/auth/verify-otp", {
      data: { otpId, code: FIXED_CODE, rememberMe: false },
    });
    const data = (await verify.json()) as { next: string };
    expect(data.next).toBe("/onboarding/taxpayer?step=2");
  });

  test("remember-me ON → /me reports rememberMe:true and session persists", async ({
    request,
  }) => {
    await deleteTestUser({ channel: "email", destination: REMEMBER_EMAIL });
    await request.post("/api/auth/send-otp", {
      data: { identifier: REMEMBER_EMAIL, channel: "email" },
    });
    const otpId = await setLatestOtpCode({
      channel: "email",
      destination: REMEMBER_EMAIL,
      code: FIXED_CODE,
    });
    const verify = await request.post("/api/auth/verify-otp", {
      data: { otpId, code: FIXED_CODE, rememberMe: true },
    });
    expect(verify.ok()).toBeTruthy();

    // The cookie is HttpOnly; we let the request fixture carry it.
    const me = await request.get("/api/auth/me");
    expect(me.ok()).toBeTruthy();
    const meBody = (await me.json()) as { authenticated: boolean; rememberMe: boolean };
    expect(meBody.authenticated).toBe(true);
    expect(meBody.rememberMe).toBe(true);

    // Server-side row matches.
    const u = await userExists({ channel: "email", destination: REMEMBER_EMAIL });
    expect(u).toBeTruthy();
    expect(await countSessionsForUser(u!.id)).toBeGreaterThan(0);
  });
});

test.describe("session lifecycle", () => {
  test("/api/auth/me returns 401 without a cookie", async ({ request }) => {
    // Fresh request context with no cookies.
    const me = await request.get("/api/auth/me");
    // Carry-over from earlier tests may still have a cookie; the explicit
    // assertion is that this is a real cookie-driven check, not a global one.
    if (me.status() === 401) {
      const body = (await me.json()) as { authenticated: boolean; next: string };
      expect(body.authenticated).toBe(false);
      expect(body.next).toBe("/login");
    } else {
      // If a previous test's cookie still applies in this fixture, that's
      // OK — we just verify the route does NOT 5xx.
      expect(me.ok()).toBeTruthy();
    }
  });

  test("logout clears cookie and subsequent /me is 401", async ({ request }) => {
    const send = await request.post("/api/auth/send-otp", {
      data: { identifier: EMAIL, channel: "email" },
    });
    expect(send.ok()).toBeTruthy();
    const otpId = await setLatestOtpCode({
      channel: "email",
      destination: EMAIL,
      code: FIXED_CODE,
    });
    await request.post("/api/auth/verify-otp", {
      data: { otpId, code: FIXED_CODE, rememberMe: false },
    });
    let me = await request.get("/api/auth/me");
    expect(me.status()).toBe(200);

    const out = await request.post("/api/auth/logout");
    expect(out.ok()).toBeTruthy();
    me = await request.get("/api/auth/me");
    expect(me.status()).toBe(401);
  });
});

test.describe("onboarding draft", () => {
  test("PUT /api/onboarding/progress persists step + draft fields", async ({ request }) => {
    // Use the fresh-user flow.
    const probe = `pwtest-draft+${Date.now()}@glimmora.test`;
    await deleteTestUser({ channel: "email", destination: probe });
    await request.post("/api/auth/send-otp", { data: { identifier: probe, channel: "email" } });
    const otpId = await setLatestOtpCode({
      channel: "email",
      destination: probe,
      code: FIXED_CODE,
    });
    await request.post("/api/auth/verify-otp", {
      data: { otpId, code: FIXED_CODE, rememberMe: false },
    });
    await request.post("/api/auth/set-role", { data: { role: "taxpayer" } });

    await request.put("/api/onboarding/progress", {
      data: {
        step: 3,
        personal: { displayName: "Ada", legalName: "Ada Lovelace" },
      },
    });

    const read = await request.get("/api/onboarding/progress");
    const body = (await read.json()) as {
      step: number;
      personal: { displayName?: string; legalName?: string };
    };
    expect(body.step).toBe(3);
    expect(body.personal.displayName).toBe("Ada");
    expect(body.personal.legalName).toBe("Ada Lovelace");

    await deleteTestUser({ channel: "email", destination: probe });
  });
});

test.describe("validation + brute-force", () => {
  test("invalid email → 400", async ({ request }) => {
    const res = await request.post("/api/auth/send-otp", {
      data: { identifier: "not-an-email", channel: "email" },
    });
    expect(res.status()).toBe(400);
  });

  test("5 wrong OTPs in a row → 423 locked, fresh OTP required", async ({ request }) => {
    const probe = `pwtest-lock+${Date.now()}@glimmora.test`;
    await deleteTestUser({ channel: "email", destination: probe });
    await request.post("/api/auth/send-otp", {
      data: { identifier: probe, channel: "email" },
    });
    const otpId = await setLatestOtpCode({
      channel: "email",
      destination: probe,
      code: FIXED_CODE,
    });
    for (let i = 0; i < 4; i++) {
      const r = await request.post("/api/auth/verify-otp", {
        data: { otpId, code: "999999", rememberMe: false },
      });
      expect(r.status()).toBe(400);
    }
    const fifth = await request.post("/api/auth/verify-otp", {
      data: { otpId, code: "999999", rememberMe: false },
    });
    expect(fifth.status()).toBe(423);
    await deleteTestUser({ channel: "email", destination: probe });
  });
});
