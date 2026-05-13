"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, invalid, children, ...rest }, ref) => {
    return (
      <div
        className={cn(
          "relative overflow-hidden rounded-lg border bg-surface-raised shadow-sm",
          invalid
            ? "border-signal-error/60 focus-within:ring-2 focus-within:ring-signal-error/25"
            : "border-line-strong focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20",
          rest.disabled && "opacity-60",
        )}
      >
        <select
          ref={ref}
          aria-invalid={invalid || undefined}
          className={cn(
            "block w-full appearance-none bg-transparent px-3.5 py-2.5 pr-10 text-[15px] text-ink focus:outline-none",
            className,
          )}
          {...rest}
        >
          {children}
        </select>
        <span
          aria-hidden
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted"
        >
          <svg viewBox="0 0 12 12" className="h-3 w-3" fill="currentColor">
            <path d="M2.22 4.47a.75.75 0 0 1 1.06 0L6 7.19l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L2.22 5.53a.75.75 0 0 1 0-1.06Z" />
          </svg>
        </span>
      </div>
    );
  },
);
Select.displayName = "Select";
