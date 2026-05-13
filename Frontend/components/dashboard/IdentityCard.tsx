import * as React from "react";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/shared/Icon";
import { Progress } from "@/components/ui/Progress";
import type { AnyProfile } from "@/lib/types";
import { initials } from "@/lib/utils/format";

export function IdentityCard({ profile }: { profile: AnyProfile }) {
  const isTaxpayer = profile.role === "taxpayer";
  return (
    <Card raised className="overflow-hidden">
      <div className="relative overflow-hidden border-b border-line-subtle bg-sovereign px-6 py-7 text-white">
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage:
              "linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />
        <div className="relative flex items-center gap-4">
          <span
            aria-hidden
            className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10 text-base font-semibold tracking-widest text-white ring-1 ring-white/15"
          >
            {initials(profile.displayName, 2)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-2xs font-medium uppercase tracking-widest text-white/60">
              {isTaxpayer ? "Taxpayer profile" : "Consultant profile"}
            </p>
            <p className="mt-0.5 truncate font-display text-2xl text-white">
              {profile.displayName}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge tone="seal" size="sm" withDot className="bg-white/10 text-white border-white/20">
                <Icon.Shield size={11} className="mr-1" /> Verified
              </Badge>
              {isTaxpayer ? (
                <Badge tone="navy" size="sm" className="bg-white/10 text-white border-white/15">
                  PAN · <span className="tabular ml-1">{profile.identity.panMasked}</span>
                </Badge>
              ) : (
                <Badge tone="navy" size="sm" className="bg-white/10 text-white border-white/15">
                  ICAI · <span className="tabular ml-1">{profile.credentials.icaiMembership}</span>
                </Badge>
              )}
            </div>
          </div>
        </div>
      </div>
      <CardBody>
        <Progress
          value={profile.profileCompleteness}
          label="Profile completeness"
          tone={profile.profileCompleteness >= 100 ? "success" : "accent"}
        />
        <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-2xs font-medium uppercase tracking-widest text-ink-subtle">
              Identity
            </dt>
            <dd className="mt-1 inline-flex items-center gap-1.5 font-medium text-signal-success">
              <Icon.Check size={12} />{" "}
              {isTaxpayer
                ? `PAN · Aadhaar`
                : `PAN · Aadhaar · ICAI`}
            </dd>
          </div>
          <div>
            <dt className="text-2xs font-medium uppercase tracking-widest text-ink-subtle">
              Mobile
            </dt>
            <dd className="mt-1 inline-flex items-center gap-1.5 text-ink">
              <Icon.Check size={12} className="text-signal-success" /> Verified
            </dd>
          </div>
          <div>
            <dt className="text-2xs font-medium uppercase tracking-widest text-ink-subtle">
              Email
            </dt>
            <dd className="mt-1 inline-flex items-center gap-1.5 text-ink">
              <Icon.Check size={12} className="text-signal-success" /> Verified
            </dd>
          </div>
          <div>
            <dt className="text-2xs font-medium uppercase tracking-widest text-ink-subtle">
              {isTaxpayer ? "Regime" : "Practice"}
            </dt>
            <dd className="mt-1 text-ink">
              {isTaxpayer
                ? profile.taxProfile.regimePreference === "new"
                  ? "New regime"
                  : "Old regime"
                : profile.credentials.firmName ?? "Independent"}
            </dd>
          </div>
        </dl>
      </CardBody>
    </Card>
  );
}
