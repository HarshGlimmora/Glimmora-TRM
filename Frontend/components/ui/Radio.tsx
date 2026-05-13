"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface RadioGroupProps {
  name: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: React.ReactNode; description?: React.ReactNode }[];
  className?: string;
  layout?: "stack" | "row";
}

export function RadioGroup({
  name,
  value,
  onChange,
  options,
  className,
  layout = "stack",
}: RadioGroupProps) {
  return (
    <div
      role="radiogroup"
      className={cn(
        "grid gap-2",
        layout === "row" && "sm:grid-flow-col sm:auto-cols-fr",
        className,
      )}
    >
      {options.map((opt) => {
        const id = `${name}-${opt.value}`;
        const checked = value === opt.value;
        return (
          <label
            key={opt.value}
            htmlFor={id}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-lg border bg-surface-raised px-3.5 py-3 transition-colors",
              checked
                ? "border-accent/45 bg-accent-soft/40 shadow-[inset_0_0_0_1px_hsl(var(--accent)/0.35)]"
                : "border-line hover:border-line-strong",
            )}
          >
            <span className="relative mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center">
              <input
                type="radio"
                id={id}
                name={name}
                value={opt.value}
                checked={checked}
                onChange={(e) => onChange(e.target.value)}
                className="peer absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-full border border-line-strong bg-surface-raised checked:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
              />
              <span
                aria-hidden
                className="pointer-events-none relative z-10 h-1.5 w-1.5 rounded-full bg-accent opacity-0 peer-checked:opacity-100"
              />
            </span>
            <div className="-mt-0.5 flex-1">
              <div className="text-sm font-medium leading-snug text-ink">
                {opt.label}
              </div>
              {opt.description && (
                <div className="mt-0.5 text-xs text-ink-muted text-pretty">
                  {opt.description}
                </div>
              )}
            </div>
          </label>
        );
      })}
    </div>
  );
}
