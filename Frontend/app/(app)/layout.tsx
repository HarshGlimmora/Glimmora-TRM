"use client";

import * as React from "react";
import { AuthGuard } from "@/components/shared/AuthGuard";
import { TopBar } from "@/components/dashboard/TopBar";
import { Assistant } from "@/components/assistant";
import { useAuthStore } from "@/lib/store/auth-store";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <Shell>{children}</Shell>
    </AuthGuard>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const profile = useAuthStore((s) => s.profile);
  return (
    <div className="min-h-dvh bg-vellum">
      {profile && <TopBar profile={profile} />}
      <main id="main" className="container pt-8 pb-20">
        {profile ? children : null}
      </main>
      {/* Assistant lives outside the profile gate so it doesn't blink off
          during zustand rehydration / route transitions. It self-suppresses
          on sensitive screens via its page registry. */}
      <Assistant />
    </div>
  );
}
