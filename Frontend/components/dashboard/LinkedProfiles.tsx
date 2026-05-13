"use client";

import * as React from "react";
import Link from "next/link";
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/shared/Icon";
import type { LinkGrant, Role } from "@/lib/types";
import { formatDate, formatRelative } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

const STATUS_TONE: Record<
  LinkGrant["status"],
  { label: string; tone: "success" | "warning" | "error" | "neutral" | "info" }
> = {
  active: { label: "Active", tone: "success" },
  pending: { label: "Pending", tone: "warning" },
  revoked: { label: "Revoked", tone: "neutral" },
  rejected: { label: "Rejected", tone: "error" },
  expired: { label: "Expired", tone: "neutral" },
};

const MODE_LABEL: Record<LinkGrant["accessMode"], string> = {
  full_access: "Full access",
  review_edit: "Review & edit",
};

export function LinkedProfiles({
  role,
  links,
  maxItems = 3,
}: {
  role: Role;
  links: LinkGrant[];
  maxItems?: number;
}) {
  const sorted = [...links].sort(
    (a, b) =>
      new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime(),
  );
  const visible = sorted.slice(0, maxItems);
  const remaining = Math.max(0, sorted.length - visible.length);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>
            {role === "taxpayer" ? "Linked consultants" : "Active clients"}
          </CardTitle>
          <CardDescription className="mt-1">
            {role === "taxpayer"
              ? "Granular access you have granted to chartered accountants."
              : "Taxpayer grants you've accepted, scoped by mode and tax year."}
          </CardDescription>
        </div>
        <Link href="/connections">
          <Button variant="outline" size="sm" rightIcon={<Icon.ChevronRight size={12} />}>
            Manage
          </Button>
        </Link>
      </CardHeader>
      <CardBody className="pt-3">
        {visible.length === 0 ? (
          <EmptyLinks role={role} />
        ) : (
          <ul className="grid gap-2">
            {visible.map((g) => (
              <LinkRow key={g.id} grant={g} role={role} />
            ))}
            {remaining > 0 && (
              <li>
                <Link
                  href="/connections"
                  className="block rounded-lg border border-dashed border-line bg-surface-sunken/40 px-4 py-3 text-center text-xs font-medium text-ink-muted hover:bg-surface-sunken hover:text-ink"
                >
                  + {remaining} more · view all
                </Link>
              </li>
            )}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function LinkRow({ grant, role }: { grant: LinkGrant; role: Role }) {
  const tone = STATUS_TONE[grant.status];
  const counterparty = role === "taxpayer" ? grant.consultantName : grant.taxpayerName;
  const detail =
    role === "taxpayer"
      ? grant.consultantFirm ?? "Independent practice"
      : `PAN ${grant.taxpayerPanMasked}`;

  return (
    <li
      className={cn(
        "group flex items-center gap-4 rounded-lg border border-line bg-surface-raised px-4 py-3 transition-colors",
        grant.status === "active" && "hover:border-line-strong",
      )}
    >
      <span
        aria-hidden
        className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-line bg-surface-sunken text-navy"
      >
        {role === "taxpayer" ? <Icon.Building size={16} /> : <Icon.User size={16} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-ink">{counterparty}</p>
          <Badge tone={tone.tone} size="sm" withDot>
            {tone.label}
          </Badge>
        </div>
        <p className="mt-0.5 truncate text-xs text-ink-muted">
          <span className="font-medium text-ink-muted">{MODE_LABEL[grant.accessMode]}</span>
          {" · "}
          {grant.taxYears.join(", ")}
          {" · "}
          {detail}
        </p>
      </div>
      <div className="hidden flex-col items-end text-right text-xs text-ink-subtle sm:flex">
        <span>{formatRelative(grant.requestedAt)}</span>
        {grant.expiresAt && grant.status === "active" && (
          <span className="text-2xs">Expires {formatDate(grant.expiresAt)}</span>
        )}
      </div>
    </li>
  );
}

function EmptyLinks({ role }: { role: Role }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-surface-sunken/40 px-5 py-7 text-center">
      <span
        aria-hidden
        className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-surface-raised text-navy"
      >
        <Icon.Link size={16} />
      </span>
      <p className="mt-3 text-sm font-medium text-ink">
        {role === "taxpayer" ? "No consultant linked yet." : "No active clients yet."}
      </p>
      <p className="mt-1 text-xs text-ink-muted text-pretty">
        {role === "taxpayer"
          ? "Grant a CA review-only or full access for your selected tax years. You can revoke anytime."
          : "Taxpayers grant you access by PAN. Open requests will appear here for you to accept."}
      </p>
      <Link href="/connections">
        <Button variant="outline" size="sm" className="mt-4" rightIcon={<Icon.ChevronRight size={12} />}>
          {role === "taxpayer" ? "Link a consultant" : "View requests"}
        </Button>
      </Link>
    </div>
  );
}
