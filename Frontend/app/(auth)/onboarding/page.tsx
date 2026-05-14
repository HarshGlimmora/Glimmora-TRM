"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/store/auth-store";

/**
 * Server-driven routing: ask /api/auth/me where this user should be.
 * If profile is complete → /dashboard. If no role yet → /role-select.
 * Otherwise → onboarding/{taxpayer|consultant}?step=N.
 */
export default function OnboardingIndex() {
  const router = useRouter();
  const loadMe = useAuthStore((s) => s.loadMe);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const me = await loadMe();
      if (cancelled) return;
      if (!me || !me.authenticated) {
        router.replace("/login");
        return;
      }
      router.replace(me.next || "/dashboard");
    })();
    return () => {
      cancelled = true;
    };
  }, [loadMe, router]);

  return null;
}
