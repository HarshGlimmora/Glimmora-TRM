import { NextResponse, type NextRequest } from "next/server";

/**
 * Adds defensive headers and reroutes obviously bad requests.
 *
 * Note: this is intentionally narrow because Glimmora TRM's frontend
 * runs as a static client-side application for now — there is no live
 * session cookie. Route protection is handled client-side via AuthGuard.
 */
export function middleware(req: NextRequest) {
  const res = NextResponse.next();

  // Prevent caching of authenticated routes
  if (
    req.nextUrl.pathname.startsWith("/dashboard") ||
    req.nextUrl.pathname.startsWith("/connections") ||
    req.nextUrl.pathname.startsWith("/onboarding") ||
    req.nextUrl.pathname.startsWith("/role-select")
  ) {
    res.headers.set("Cache-Control", "no-store, max-age=0");
    res.headers.set("Pragma", "no-cache");
  }

  res.headers.set("X-Robots-Tag", "noindex, nofollow");
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png|.*\\.svg).*)"],
};
