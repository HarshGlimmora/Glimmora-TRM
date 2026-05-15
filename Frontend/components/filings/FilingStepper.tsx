"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";

export type FilingStepKey =
  | "documents"
  | "transactions"
  | "regime"
  | "summary"
  | "submit";

const STEPS: { key: FilingStepKey; label: string }[] = [
  { key: "documents", label: "Documents" },
  { key: "transactions", label: "Transactions" },
  { key: "regime", label: "Regime" },
  { key: "summary", label: "Summary" },
  { key: "submit", label: "Submit" },
];

export function FilingStepper({ active }: { active: FilingStepKey }) {
  const activeIdx = STEPS.findIndex((s) => s.key === active);
  return (
    <ol className="flex w-full items-center gap-2 overflow-x-auto">
      {STEPS.map((s, i) => {
        const done = i < activeIdx;
        const current = i === activeIdx;
        return (
          <li key={s.key} className="flex min-w-0 flex-1 items-center gap-2">
            <span
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                done && "bg-navy text-white",
                current && "bg-navy text-white ring-4 ring-navy/15",
                !done && !current && "bg-surface-sunken text-ink-muted",
              )}
              aria-current={current ? "step" : undefined}
            >
              {i + 1}
            </span>
            <span
              className={cn(
                "truncate text-sm",
                current ? "font-semibold text-ink" : "text-ink-muted",
              )}
            >
              {s.label}
            </span>
            {i < STEPS.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  "mx-1 h-px flex-1",
                  i < activeIdx ? "bg-navy" : "bg-line",
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
