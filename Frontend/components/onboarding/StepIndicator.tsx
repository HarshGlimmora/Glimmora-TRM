"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";
import { Icon } from "@/components/shared/Icon";

export interface Step {
  key: string;
  label: string;
  description?: string;
}

interface StepIndicatorProps {
  steps: Step[];
  current: number;
  onJump?: (index: number) => void;
  className?: string;
  orientation?: "horizontal" | "vertical";
}

export function StepIndicator({
  steps,
  current,
  onJump,
  className,
  orientation = "horizontal",
}: StepIndicatorProps) {
  if (orientation === "vertical") {
    return (
      <ol className={cn("flex flex-col gap-1", className)}>
        {steps.map((s, i) => {
          const done = i < current;
          const active = i === current;
          const reachable = i <= current;
          return (
            <li key={s.key}>
              <button
                type="button"
                disabled={!reachable || !onJump}
                onClick={() => reachable && onJump?.(i)}
                aria-current={active ? "step" : undefined}
                className={cn(
                  "group flex w-full items-start gap-3 rounded-lg p-2.5 text-left transition-colors",
                  active && "bg-navy-tint",
                  reachable && !active && "hover:bg-surface-sunken",
                  !reachable && "cursor-default opacity-60",
                )}
              >
                <span
                  className={cn(
                    "mt-px flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular",
                    done
                      ? "border-navy bg-navy text-white"
                      : active
                        ? "border-navy text-navy bg-surface-raised"
                        : "border-line bg-surface-raised text-ink-subtle",
                  )}
                  aria-hidden
                >
                  {done ? <Icon.Check size={12} /> : i + 1}
                </span>
                <span className="-mt-px flex-1">
                  <span
                    className={cn(
                      "block text-sm font-medium",
                      active ? "text-ink" : "text-ink-muted",
                    )}
                  >
                    {s.label}
                  </span>
                  {s.description && (
                    <span className="mt-0.5 block text-xs text-ink-subtle">
                      {s.description}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    );
  }

  return (
    <ol
      className={cn("flex w-full items-center gap-2", className)}
      aria-label="Onboarding progress"
    >
      {steps.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <React.Fragment key={s.key}>
            <li className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
              <span
                aria-hidden
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-semibold tabular transition-colors",
                  done
                    ? "border-navy bg-navy text-white"
                    : active
                      ? "border-navy bg-surface-raised text-navy"
                      : "border-line bg-surface-raised text-ink-subtle",
                )}
              >
                {done ? <Icon.Check size={12} /> : i + 1}
              </span>
              <span
                className={cn(
                  "truncate text-2xs font-medium uppercase tracking-widest",
                  active ? "text-ink" : "text-ink-subtle",
                )}
              >
                {s.label}
              </span>
            </li>
            {i < steps.length - 1 && (
              <li
                aria-hidden
                className={cn(
                  "-mt-4 h-px flex-1 transition-colors",
                  i < current ? "bg-navy" : "bg-line",
                )}
              />
            )}
          </React.Fragment>
        );
      })}
    </ol>
  );
}
