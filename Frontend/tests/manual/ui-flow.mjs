/**
 * Headless Chromium drive of the full /login → /role-select → /dashboard
 * flow against the live dev server + PGlite.
 *
 *   node tests/manual/ui-flow.mjs
 *
 * Reads the OTP code from the dev-server's `[email.dev] OTP for <addr>: <code>`
 * log line, so it doesn't need a real inbox. Captures every console / network
 * event for diagnosis. Saves a final screenshot to ./tests/manual/ui-flow-final.png.
 */
import { chromium } from "@playwright/test";
import { promises as fs } from "node:fs";

const BASE = process.env.PW_BASE_URL ?? "http://localhost:3717";
const EMAIL = process.env.GLMRA_TEST_EMAIL ?? "harshchinchakar33@gmail.com";
const DEV_LOG = process.env.DEV_LOG;
if (!DEV_LOG) {
  console.error("DEV_LOG env var (path to dev-server stdout/stderr) is required.");
  process.exit(2);
}

const log = (tag, ...args) => console.log(`[${tag}]`, ...args);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readLatestOtp(email, sinceMs) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const raw = await fs.readFile(DEV_LOG, "utf8");
      const re = new RegExp(
        `OTP for ${email.replace(/[.+@]/g, (c) => `\\${c}`)}: (\\d{6})`,
        "g",
      );
      const codes = [...raw.matchAll(re)].map((m) => m[1]);
      const code = codes[codes.length - 1];
      if (code && Date.now() - sinceMs > 250) return code;
    } catch {
      /* dev log not readable */
    }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for fresh OTP for ${email}`);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ baseURL: BASE });
const page = await context.newPage();

page.on("console", (msg) => {
  if (msg.type() === "error" || msg.type() === "warning") {
    log("console." + msg.type(), msg.text());
  }
});
page.on("pageerror", (err) => log("pageerror", err.message));
page.on("response", (res) => {
  const url = res.url();
  if (!url.includes("/api/")) return;
  const sc = res.headers()["set-cookie"];
  log(
    "response",
    res.status(),
    res.request().method(),
    url.replace(BASE, ""),
    sc ? `Set-Cookie=${sc.split(";")[0]}` : "",
  );
});
page.on("framenavigated", (frame) => {
  if (frame === page.mainFrame()) log("nav", frame.url().replace(BASE, ""));
});

try {
  log("step", "open /login");
  await page.goto("/login");
  await page.waitForSelector('input[name="identifier"]');

  log("step", "fill email + tick remember-me");
  await page.fill('input[name="identifier"]', EMAIL);
  const remember = page.getByLabel(/Remember me on this device/i);
  if (await remember.isVisible().catch(() => false)) await remember.check();

  log("step", "click Send");
  const sendT0 = Date.now();
  await page.getByRole("button", { name: /send 6-digit code/i }).click();
  await page.getByRole("heading", { name: /enter the code/i }).waitFor({
    timeout: 60_000,
  });

  const otp = await readLatestOtp(EMAIL, sendT0);
  log("step", `OTP from dev log: ${otp[0]}*****`);

  const cells = page.locator('input[inputmode="numeric"]');
  for (let i = 0; i < 6; i++) await cells.nth(i).press(otp[i]);

  log("step", "wait for navigation away from /login");
  await page.waitForURL((url) => !url.pathname.endsWith("/login"), {
    timeout: 15_000,
  });
  log("nav.after-otp", page.url().replace(BASE, ""));

  // Should be /role-select for a fresh user.
  if (!page.url().includes("/role-select")) {
    throw new Error(`Expected /role-select after OTP, got ${page.url()}`);
  }
  await page.getByText(/Choose your role/i).waitFor();

  log("step", "click 'I am a Taxpayer'");
  await page.getByRole("button", { name: /Taxpayer/i }).first().click();
  await page.getByRole("button", { name: /Continue/i }).click();

  log("step", "wait for /onboarding/taxpayer");
  await page.waitForURL(/\/onboarding\/taxpayer/, { timeout: 15_000 });
  log("nav.after-role", page.url().replace(BASE, ""));

  // We're now in the multi-step onboarding. Confirm step indicator visible.
  await page.getByText(/Tell us who you are/i).waitFor({ timeout: 10_000 });

  log("step", "/api/auth/me probe from inside the page");
  const meProbe = await page.evaluate(async () => {
    const r = await fetch("/api/auth/me", {
      credentials: "same-origin",
      cache: "no-store",
    });
    return { status: r.status, body: await r.json() };
  });
  log("probe.me", JSON.stringify(meProbe));

  const cookies = await context.cookies();
  log(
    "cookies",
    cookies
      .filter((c) => c.name.startsWith("glmra"))
      .map((c) => `${c.name}=${c.value.slice(0, 10)}… exp=${c.expires}`)
      .join("; ") || "<none>",
  );

  await page.screenshot({
    path: "tests/manual/ui-flow-final.png",
    fullPage: true,
  });
  log("step", "SUCCESS — screenshot → tests/manual/ui-flow-final.png");
} catch (err) {
  console.error("[ERR]", err);
  await page.screenshot({
    path: "tests/manual/ui-flow-error.png",
    fullPage: true,
  }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
