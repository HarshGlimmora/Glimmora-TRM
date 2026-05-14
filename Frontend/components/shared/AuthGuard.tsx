"use client";

import * as React from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuthStore } from "@/lib/store/auth-store";
import type { Role } from "@/lib/types";

/**
 * Server-driven route guard.
 *
 * On mount we call `/api/auth/me`. The server:
 *   - returns 401 if the cookie is missing/expired/revoked → we redirect to /login
 *   - returns 200 with `{ next }` telling us where this user is supposed to be
 *
 * If the user is on the wrong route for their state (e.g. a profile-complete
 * user landing on /onboarding/...), the server-recommended `next` URL wins.
 * This keeps routing decisions in one place (lib/server/services/auth.ts).
 */
export function AuthGuard({
  children,
  requireRole,
}: {
  children: React.ReactNode;
  requireRole?: Role;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const loadMe = useAuthStore((s) => s.loadMe);
  const me = useAuthStore((s) => s.me);
  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);
  const next = useAuthStore((s) => s.next);
  const bootstrapped = useAuthStore((s) => s.bootstrapped);

  const [checking, setChecking] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await loadMe();
      if (cancelled) return;
      if (!data || !data.authenticated) {
        router.replace(`/login?from=${encodeURIComponent(pathname)}`);
        return;
      }
      // Role gate (e.g. CA-only pages)
      if (requireRole && data.user.role && data.user.role !== requireRole) {
        router.replace("/dashboard");
        return;
      }
      // The server's `next` is a *landing hint* (default destination right
      // after login). For users with a completed profile it's always
      // /dashboard — but that must NOT trap them on /dashboard when they
      // explicitly navigate to other app pages like /connections.
      // Only follow `next` when the user actually belongs somewhere else
      // (login required, role pick required, onboarding incomplete).
      if (data.next && !data.hasProfile) {
        const suggested = stripQuery(data.next);
        const current = stripQuery(pathname);
        if (suggested !== current && !sameFamily(suggested, current)) {
          router.replace(data.next);
          return;
        }
      }
      setChecking(false);
    })();
    return () => {
      cancelled = true;
    };
    // We only want this effect to run once on mount per page navigation.
    // pathname dep lets us re-check when navigating between guarded pages.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  if (!bootstrapped || checking) {
    return (
      <div className="grid min-h-dvh place-items-center bg-vellum">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-navy/20 border-t-navy" />
          <p className="text-xs text-ink-muted">Verifying session…</p>
        </div>
      </div>
    );
  }

  // After bootstrap, if we still have nothing, something went sideways.
  if (!session || !me) return null;

  // For pages that need a finished profile, ensure we have one.
  if (!profile && me.profileCompletedAt) {
    // Profile is complete server-side but our cache hasn't synthesized it
    // yet — show the skeleton briefly.
    return null;
  }

  // Suppress unused-warning for `next` — read at top of effect.
  void next;

  return <>{children}</>;
}

function stripQuery(href: string): string {
  const i = href.indexOf("?");
  return i === -1 ? href : href.slice(0, i);
}

/** Treat /onboarding/taxpayer vs /onboarding/consultant as the same family
 *  as the suggested route when stepping inside onboarding. */
function sameFamily(a: string, b: string): boolean {
  return a.startsWith("/onboarding/") && b.startsWith("/onboarding/");
}
