import * as React from "react";
import type { ActivityItem } from "@/lib/types";
import { cn } from "@/lib/utils/cn";
import { formatRelative } from "@/lib/utils/format";
import { Icon } from "@/components/shared/Icon";

const KIND_TO_STYLE: Record<
  ActivityItem["kind"],
  { label: string; icon: React.ReactNode; ring: string; iconBg: string }
> = {
  verification: {
    label: "Identity",
    icon: <Icon.Shield size={12} />,
    ring: "ring-signal-success/30",
    iconBg: "bg-signal-success text-white",
  },
  linking: {
    label: "Linking",
    icon: <Icon.Link size={12} />,
    ring: "ring-accent/30",
    iconBg: "bg-accent text-white",
  },
  profile: {
    label: "Profile",
    icon: <Icon.User size={12} />,
    ring: "ring-navy/30",
    iconBg: "bg-navy text-white",
  },
  system: {
    label: "Session",
    icon: <Icon.Lock size={12} />,
    ring: "ring-line",
    iconBg: "bg-ink-muted text-white",
  },
  advisory: {
    label: "Advisory",
    icon: <Icon.Info size={12} />,
    ring: "ring-signal-info/30",
    iconBg: "bg-signal-info text-white",
  },
};

export function ActivityTimeline({ items }: { items: ActivityItem[] }) {
  if (items.length === 0)
    return (
      <p className="text-sm text-ink-muted">No activity yet.</p>
    );
  return (
    <ol className="relative">
      {items.map((it, i) => {
        const style = KIND_TO_STYLE[it.kind];
        const isLast = i === items.length - 1;
        return (
          <li key={it.id} className="grid grid-cols-[auto_1fr] gap-x-4">
            <div className="flex flex-col items-center">
              <span
                aria-hidden
                className={cn(
                  "relative inline-flex h-7 w-7 items-center justify-center rounded-full ring-4 ring-offset-2 ring-offset-surface-raised",
                  style.ring,
                  style.iconBg,
                )}
              >
                {style.icon}
              </span>
              {!isLast && (
                <span
                  aria-hidden
                  className="my-1 w-px flex-1 bg-line"
                  style={{ minHeight: 32 }}
                />
              )}
            </div>
            <div className="pb-6">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-medium text-ink">{it.title}</p>
                <time
                  dateTime={it.at}
                  className="flex-shrink-0 text-xs text-ink-subtle"
                >
                  {formatRelative(it.at)}
                </time>
              </div>
              {it.description && (
                <p className="mt-1 text-sm text-ink-muted text-pretty">
                  {it.description}
                </p>
              )}
              <span className="mt-2 inline-flex items-center gap-1 text-2xs font-medium uppercase tracking-widest text-ink-subtle">
                <span
                  aria-hidden
                  className={cn("h-1 w-1 rounded-full", style.iconBg)}
                />
                {style.label}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
