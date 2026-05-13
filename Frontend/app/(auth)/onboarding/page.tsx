"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/store/auth-store";

export default function OnboardingIndex() {
  const router = useRouter();
  const role = useAuthStore((s) => s.role);
  const session = useAuthStore((s) => s.session);

  useEffect(() => {
    if (!session) {
      router.replace("/login");
      return;
    }
    if (!role) {
      router.replace("/role-select");
      return;
    }
    router.replace(
      role === "consultant"
        ? "/onboarding/consultant"
        : "/onboarding/taxpayer",
    );
  }, [role, session, router]);

  return null;
}
