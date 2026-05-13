"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: React.ReactNode;
  description?: React.ReactNode;
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ label, description, className, id, ...rest }, ref) => {
    const autoId = React.useId();
    const inputId = id ?? autoId;
    return (
      <label
        htmlFor={inputId}
        className={cn(
          "group flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-surface-raised px-3.5 py-3 transition-colors",
          "hover:border-line-strong has-[:checked]:border-accent/40 has-[:checked]:bg-accent-soft/40",
          rest.disabled && "cursor-not-allowed opacity-60",
          className,
        )}
      >
        <span className="relative mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center">
          <input
            ref={ref}
            type="checkbox"
            id={inputId}
            className="peer absolute inset-0 h-full w-full cursor-pointer appearance-none rounded border border-line-strong bg-surface-raised checked:border-accent checked:bg-accent focus-visible:ring-2 focus-visible:ring-accent/30"
            {...rest}
          />
          <svg
            aria-hidden
            viewBox="0 0 16 16"
            className="pointer-events-none relative z-10 h-3 w-3 text-white opacity-0 peer-checked:opacity-100"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 8.5l3 3 7-7" />
          </svg>
        </span>
        <div className="-mt-0.5 flex-1">
          {label && (
            <div className="text-sm font-medium leading-snug text-ink">
              {label}
            </div>
          )}
          {description && (
            <div className="mt-0.5 text-xs text-ink-muted text-pretty">
              {description}
            </div>
          )}
        </div>
      </label>
    );
  },
);
Checkbox.displayName = "Checkbox";
