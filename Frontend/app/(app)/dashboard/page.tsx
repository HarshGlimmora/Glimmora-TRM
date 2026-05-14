"use client";

import * as React from "react";
import { useAuthStore } from "@/lib/store/auth-store";
import { fetchDashboard } from "@/lib/api";
import type { DashboardSummary } from "@/lib/types";
import { PrimaryCta } from "@/components/dashboard/PrimaryCta";
import { IdentityCard } from "@/components/dashboard/IdentityCard";
import { StatCard } from "@/components/dashboard/StatCard";
import { ActivityTimeline } from "@/components/dashboard/ActivityTimeline";
import { LinkedProfiles } from "@/components/dashboard/LinkedProfiles";
import { UpcomingList } from "@/components/dashboard/UpcomingList";
import { AlertList } from "@/components/dashboard/AlertList";
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/shared/Icon";

export default function DashboardPage() {
  const profile = useAuthStore((s) => s.profile);
  const [data, setData] = React.useState<DashboardSummary | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    if (!profile) return;
    setLoading(true);
    fetchDashboard(profile).then((d) => {
      if (!cancelled) {
        setData(d);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [profile]);

  if (!profile) return null;

  if (loading || !data) {
    return <DashboardSkeleton />;
  }

  return (
    <div className="flex flex-col gap-8 animate-fade-up">
      <PrimaryCta role={profile.role} displayName={profile.displayName} />

      {data.alerts.length > 0 && <AlertList alerts={data.alerts} />}

      <section
        aria-label="Summary metrics"
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        {data.stats.map((s) => (
          <StatCard
            key={s.label}
            label={s.label}
            value={s.value}
            helper={s.helper}
            tone={s.tone ?? "default"}
          />
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-3">
              <div>
                <CardTitle>Recent activity</CardTitle>
                <CardDescription className="mt-1">
                  An append-only record of identity, profile and linking events.
                </CardDescription>
              </div>
              <Badge tone="navy" size="sm" withDot>
                Audit trail
              </Badge>
            </CardHeader>
            <CardBody className="pt-2">
              <ActivityTimeline items={data.activity} />
            </CardBody>
          </Card>

          <LinkedProfiles role={profile.role} links={data.links} />
        </div>

        <div className="flex flex-col gap-6">
          <IdentityCard profile={profile} />
          <UpcomingList items={data.upcoming} />
          <TrustPanel />
        </div>
      </div>
    </div>
  );
}

function TrustPanel() {
  return (
    <Card inset>
      <CardBody>
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-navy text-white"
          >
            <Icon.Shield size={16} />
          </span>
          <div className="flex-1">
            <p className="text-2xs font-medium uppercase tracking-widest text-navy">
              Why this dashboard is calm
            </p>
            <p className="mt-1 text-sm text-ink text-pretty">
              You will never see another taxpayer&apos;s data here. Filings,
              notices and operational widgets live in dedicated workspaces that
              load only when you open them — keeping the home view clear,
              consent-aware, and audit-traceable.
            </p>
            <ul className="mt-3 grid gap-2 text-xs text-ink-muted">
              <li className="inline-flex items-start gap-2">
                <Icon.Check size={12} className="mt-0.5 text-accent" />
                Sensitive identifiers are masked across the interface.
              </li>
              <li className="inline-flex items-start gap-2">
                <Icon.Check size={12} className="mt-0.5 text-accent" />
                Linking is consent-gated and revocable.
              </li>
              <li className="inline-flex items-start gap-2">
                <Icon.Check size={12} className="mt-0.5 text-accent" />
                Every action emits an entry in your audit trail.
              </li>
            </ul>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="h-44 rounded-2xl bg-navy-tint animate-soft-pulse" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-28 animate-soft-pulse rounded-xl border border-line bg-surface-raised"
          />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="h-96 animate-soft-pulse rounded-xl border border-line bg-surface-raised" />
        <div className="h-96 animate-soft-pulse rounded-xl border border-line bg-surface-raised" />
      </div>
    </div>
  );
}
