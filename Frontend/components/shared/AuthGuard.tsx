"use client";

import * as React from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuthStore } from "@/lib/store/auth-store";
import { getProfile } from "@/lib/api";
import type { Role } from "@/lib/types";

/**
 * Client-side route guard.
 *
 * Responsibilities:
 *   - Block access if there is no live session.
 *   - Block access if the session has expired (TTL).
 *   - Restrict by role when `requireRole` is provided.
 *   - Hydrate the in-memory profile from the API when we only have a profileId.
 */
export function AuthGuard({
  children,
  requireRole,
  requireProfile = true,
}: {
  children: React.ReactNode;
  requireRole?: Role;
  requireProfile?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const bootstrapped = useAuthStore((s) => s.bootstrapped);
  const session = useAuthStore((s) => s.session);
  const role = useAuthStore((s) => s.role);
  const profile = useAuthStore((s) => s.profile);
  const profileId = useAuthStore((s) => s.profileId);
  const isExpired = useAuthStore((s) => s.isExpired);
  const setProfile = useAuthStore((s) => s.setProfile);
  const signOut = useAuthStore((s) => s.signOut);

  const [checking, setChecking] = React.useState(true);

  React.useEffect(() => {
    if (!bootstrapped) return;
    const expired = isExpired();
    if (!session || expired) {
      if (expired && session) signOut();
      router.replace(`/login?from=${encodeURIComponent(pathname)}`);
      return;
    }
    if (requireRole && role && role !== requireRole) {
      router.replace("/dashboard");
      return;
    }
    if (requireProfile && !profile) {
      // Try to rehydrate from sample data
      if (profileId) {
        getProfile(profileId).then((p) => {
          if (p) setProfile(p);
          setChecking(false);
        });
      } else {
        // No profile and no id — send to onboarding
        router.replace(
          role === "consultant"
            ? "/onboarding/consultant"
            : "/onboarding/taxpayer",
        );
      }
    } else {
      setChecking(false);
    }
  }, [
    bootstrapped,
    session,
    pathname,
    requireRole,
    requireProfile,
    role,
    profile,
    profileId,
    router,
    isExpired,
    setProfile,
    signOut,
  ]);

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

  return <>{children}</>;
}
