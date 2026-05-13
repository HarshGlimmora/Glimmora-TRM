import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface StatCardProps {
  label: string;
  value: string | number;
  helper?: string;
  tone?: "default" | "accent" | "warning" | "success";
  trailing?: React.ReactNode;
  className?: string;
}

export function StatCard({
  label,
  value,
  helper,
  tone = "default",
  trailing,
  className,
}: StatCardProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-line bg-surface-raised p-5 shadow-card",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute left-0 top-0 h-full w-1",
          tone === "warning"
            ? "bg-signal-warning"
            : tone === "success"
              ? "bg-signal-success"
              : tone === "accent"
                ? "bg-accent"
                : "bg-navy",
        )}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="micro-label">{label}</p>
          <p
            className={cn(
              "mt-2 truncate font-display text-3xl tabular leading-none text-ink",
            )}
          >
            {value}
          </p>
          {helper && (
            <p className="mt-2 text-xs text-ink-muted text-pretty">{helper}</p>
          )}
        </div>
        {trailing && <div className="flex-shrink-0">{trailing}</div>}
      </div>
    </div>
  );
}
