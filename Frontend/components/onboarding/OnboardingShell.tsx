"use client";

import * as React from "react";
import Link from "next/link";
import { Logo } from "@/components/shared/Logo";
import { RoleBadge } from "@/components/shared/RoleBadge";
import { StepIndicator, type Step } from "@/components/onboarding/StepIndicator";
import { Icon } from "@/components/shared/Icon";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils/cn";
import type { Role } from "@/lib/types";

interface OnboardingShellProps {
  role: Role;
  steps: Step[];
  current: number;
  onBack?: () => void;
  onJump?: (i: number) => void;
  draftSaved?: boolean;
  children: React.ReactNode;
  aside?: React.ReactNode;
}

export function OnboardingShell({
  role,
  steps,
  current,
  onBack,
  onJump,
  draftSaved,
  children,
  aside,
}: OnboardingShellProps) {
  return (
    <div className="min-h-dvh bg-vellum">
      <header className="sticky top-0 z-30 border-b border-line bg-surface-raised/85 backdrop-blur supports-[backdrop-filter]:bg-surface-raised/65">
        <div className="container flex h-24 items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" aria-label="Glimmora home">
              <Logo size="sm" />
            </Link>
            <span aria-hidden className="hidden h-5 w-px bg-line sm:block" />
            <span className="hidden text-xs text-ink-muted sm:inline-flex sm:items-center sm:gap-2">
              <Icon.Lock size={12} /> Onboarding · profile creation
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span
              aria-live="polite"
              className={cn(
                "hidden items-center gap-1.5 text-xs text-ink-muted sm:inline-flex",
                draftSaved && "text-signal-success",
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  draftSaved
                    ? "bg-signal-success"
                    : "bg-ink-subtle animate-soft-pulse",
                )}
              />
              {draftSaved ? "Draft saved" : "Editing"}
            </span>
            <RoleBadge role={role} />
          </div>
        </div>
      </header>

      <div className="container grid gap-8 py-10 lg:grid-cols-[260px_1fr_280px]">
        <aside className="hidden lg:block">
          <div className="sticky top-24 rounded-xl border border-line bg-surface-raised p-3 shadow-card">
            <p className="micro-label px-2 pt-1">Profile steps</p>
            <StepIndicator
              steps={steps}
              current={current}
              onJump={onJump}
              orientation="vertical"
              className="mt-2"
            />
          </div>
        </aside>

        <main id="main" className="min-w-0">
          <div className="lg:hidden">
            <StepIndicator steps={steps} current={current} onJump={onJump} />
          </div>

          {children}

          {onBack && (
            <div className="mt-4 lg:hidden">
              <Button
                variant="ghost"
                size="sm"
                onClick={onBack}
                leftIcon={<Icon.ChevronLeft size={14} />}
              >
                Back
              </Button>
            </div>
          )}
        </main>

        <aside className="hidden lg:block">
          <div className="sticky top-24 space-y-4">{aside}</div>
        </aside>
      </div>
    </div>
  );
}
