"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";
import type { TxnProgress } from "@/lib/api/transactions";

export function VerifyProgressBar({
  progress,
  className,
}: {
  progress: TxnProgress;
  className?: string;
}) {
  const { total, verified, unverified, rejected, percent } = progress;
  const done = percent >= 100;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold tabular-nums text-ink">
            {percent.toFixed(0)}%
          </span>
          <span className="text-xs uppercase tracking-wider text-ink-muted">
            verified
          </span>
        </div>
        <div className="flex gap-3 text-xs text-ink-muted">
          <span>
            <span className="font-medium text-ink">{verified}</span> verified
          </span>
          <span>
            <span className="font-medium text-ink">{unverified}</span> unverified
          </span>
          {rejected > 0 && (
            <span>
              <span className="font-medium text-signal-error">{rejected}</span> rejected
            </span>
          )}
          <span>
            <span className="font-medium text-ink">{total}</span> total
          </span>
        </div>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-surface-sunken"
        role="progressbar"
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cn(
            "h-full rounded-full transition-all",
            done ? "bg-signal-success" : "bg-navy",
          )}
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>
    </div>
  );
}
