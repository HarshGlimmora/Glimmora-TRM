import "server-only";
import { cookies } from "next/headers";

export const SESSION_COOKIE_NAME = "glmra_session";

/** Short session TTL — when remember-me is OFF. */
export const SHORT_TTL_SECONDS = 4 * 60 * 60;          // 4 hours
/** Long session TTL — when remember-me is ON. Survives browser restart. */
export const LONG_TTL_SECONDS = 30 * 24 * 60 * 60;     // 30 days

interface SetSessionCookieArgs {
  token: string;
  rememberMe: boolean;
}

export function setSessionCookie({ token, rememberMe }: SetSessionCookieArgs): void {
  const isProd = process.env.NODE_ENV === "production";
  cookies().set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    // When remember-me is OFF we omit maxAge so the cookie is a *session
    // cookie* that dies on browser close. Even though the server-side row
    // has a 4h TTL, the cookie itself is gone the moment the user closes
    // the tab — matching "do not remember me" intent.
    ...(rememberMe ? { maxAge: LONG_TTL_SECONDS } : {}),
  });
}

export function clearSessionCookie(): void {
  cookies().set({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export function readSessionCookie(): string | null {
  return cookies().get(SESSION_COOKIE_NAME)?.value ?? null;
}
