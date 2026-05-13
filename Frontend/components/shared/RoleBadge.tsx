import * as React from "react";
import { Badge } from "@/components/ui/Badge";
import type { Role } from "@/lib/types";
import { cn } from "@/lib/utils/cn";

const ROLE_META: Record<Role, { label: string; tone: "navy" | "seal" }> = {
  taxpayer: { label: "Taxpayer", tone: "navy" },
  consultant: { label: "Consultant · CA", tone: "seal" },
};

export function RoleBadge({
  role,
  identifier,
  className,
}: {
  role: Role;
  identifier?: string;
  className?: string;
}) {
  const meta = ROLE_META[role];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-line bg-surface-raised py-1 pl-1 pr-3 shadow-sm",
        className,
      )}
    >
      <Badge tone={meta.tone} size="sm">
        {meta.label}
      </Badge>
      {identifier && (
        <span className="tabular text-xs font-medium text-ink">{identifier}</span>
      )}
    </span>
  );
}
