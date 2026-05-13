"use client";

import * as React from "react";
import { AuthGuard } from "@/components/shared/AuthGuard";
import { TopBar } from "@/components/dashboard/TopBar";
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
  if (!profile) return null;
  return (
    <div className="min-h-dvh bg-vellum">
      <TopBar profile={profile} />
      <main id="main" className="container pt-8 pb-20">
        {children}
      </main>
    </div>
  );
}
