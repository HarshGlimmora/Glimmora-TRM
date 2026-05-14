"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/shared/Icon";
import { Alert } from "@/components/ui/Alert";
import { useAuthStore } from "@/lib/store/auth-store";
import { useOnboardingStore } from "@/lib/store/onboarding-store";
import { setRole as setRoleApi } from "@/lib/api";
import type { Role } from "@/lib/types";
import { cn } from "@/lib/utils/cn";

const ROLES: {
  value: Role;
  title: string;
  description: string;
  bullets: string[];
  icon: React.ReactNode;
}[] = [
  {
    value: "taxpayer",
    title: "I am a Taxpayer",
    description:
      "File your returns, link a consultant, and keep an audit-friendly history of every action.",
    bullets: [
      "PAN & Aadhaar identity verification",
      "Three-consent data control",
      "Optional CA linking with granular access",
    ],
    icon: <Icon.User size={20} />,
  },
  {
    value: "consultant",
    title: "I am a Chartered Accountant",
    description:
      "Practice with verified credentials, accept client requests, and manage filings under explicit access grants.",
    bullets: [
      "ICAI membership verification",
      "Granular full or review-only access",
      "Audit-traceable client interactions",
    ],
    icon: <Icon.Building size={20} />,
  },
];

export default function RoleSelectPage() {
  const router = useRouter();
  const loadMe = useAuthStore((s) => s.loadMe);
  const session = useAuthStore((s) => s.session);
  const setAuthRole = useAuthStore((s) => s.setRole);
  const onboardingSetRole = useOnboardingStore((s) => s.setRole);

  React.useEffect(() => {
    void (async () => {
      const me = await loadMe();
      if (!me || !me.authenticated) router.replace("/login");
    })();
  }, [loadMe, router]);

  const [selected, setSelected] = React.useState<Role | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const onContinue = async () => {
    if (!selected || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await setRoleApi(selected);
      setAuthRole(selected);
      onboardingSetRole(selected);
      // Prime cache so onboarding can immediately read me.role.
      await loadMe();
      router.push(res.next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save role.");
      setSubmitting(false);
    }
  };

  // Silence unused-warning while session is still consumed by isExpired below.
  void session;

  return (
    <AuthShell step={{ current: 1, total: 5, label: "Role" }}>
      <div className="animate-fade-up">
        <Badge tone="navy" withDot size="sm">
          Choose your role
        </Badge>
        <h2 className="mt-4 font-display text-4xl leading-tight text-ink">
          How do you use
          <br />
          Glimmora TRM?
        </h2>
        <p className="mt-3 text-pretty text-sm text-ink-muted">
          This selection determines your onboarding flow and what your dashboard
          will look like. You can request additional roles later from your
          profile.
        </p>

        <div className="mt-8 grid gap-3">
          {ROLES.map((r) => {
            const active = selected === r.value;
            return (
              <button
                key={r.value}
                type="button"
                onClick={() => setSelected(r.value)}
                aria-pressed={active}
                className={cn(
                  "group flex w-full items-start gap-4 rounded-xl border bg-surface-raised p-4 text-left transition-all duration-150",
                  active
                    ? "border-accent/40 bg-accent-soft/30 shadow-[0_0_0_1px_hsl(var(--accent)/0.3)]"
                    : "border-line hover:border-line-strong hover:bg-surface-sunken/50",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border transition-colors",
                    active
                      ? "border-accent/30 bg-accent text-white"
                      : "border-line bg-surface-sunken text-navy",
                  )}
                >
                  {r.icon}
                </span>
                <span className="flex-1">
                  <span className="flex items-center justify-between gap-3">
                    <span className="text-[15px] font-semibold tracking-[-0.005em] text-ink">
                      {r.title}
                    </span>
                    <span
                      aria-hidden
                      className={cn(
                        "inline-flex h-5 w-5 items-center justify-center rounded-full border transition-colors",
                        active
                          ? "border-accent bg-accent text-white"
                          : "border-line bg-surface-sunken text-transparent",
                      )}
                    >
                      <Icon.Check size={12} />
                    </span>
                  </span>
                  <p className="mt-1 text-sm/relaxed text-ink-muted text-pretty">
                    {r.description}
                  </p>
                  <ul className="mt-3 grid gap-1.5">
                    {r.bullets.map((b) => (
                      <li
                        key={b}
                        className="flex items-start gap-2 text-xs text-ink-muted"
                      >
                        <Icon.Check
                          size={12}
                          className="mt-0.5 flex-shrink-0 text-accent"
                        />
                        {b}
                      </li>
                    ))}
                  </ul>
                </span>
              </button>
            );
          })}
        </div>

        <Alert tone="info" compact className="mt-6">
          You can revoke or change linked profiles at any time. Every role change
          is recorded in your audit trail.
        </Alert>

        {error && (
          <Alert tone="error" compact className="mt-4">
            {error}
          </Alert>
        )}

        <div className="mt-6 flex items-center justify-end gap-3">
          <Button
            size="lg"
            disabled={!selected}
            loading={submitting}
            onClick={onContinue}
            rightIcon={<Icon.ArrowRight size={16} />}
          >
            Continue
          </Button>
        </div>
      </div>
    </AuthShell>
  );
}
