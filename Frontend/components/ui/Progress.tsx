import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface ProgressProps {
  value: number;
  label?: string;
  tone?: "accent" | "success" | "warning";
  size?: "sm" | "md";
  className?: string;
}

export function Progress({
  value,
  label,
  tone = "accent",
  size = "md",
  className,
}: ProgressProps) {
  const v = Math.min(100, Math.max(0, value));
  const toneCls =
    tone === "success"
      ? "bg-signal-success"
      : tone === "warning"
        ? "bg-signal-warning"
        : "bg-accent";
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <div className="flex items-baseline justify-between">
          <span className="micro-label">{label}</span>
          <span className="text-xs font-medium tabular text-ink-muted">{v}%</span>
        </div>
      )}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={v}
        className={cn(
          "w-full overflow-hidden rounded-full bg-line-subtle",
          size === "sm" ? "h-1" : "h-1.5",
        )}
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500 ease-out",
            toneCls,
          )}
          style={{ width: `${v}%` }}
        />
      </div>
    </div>
  );
}
