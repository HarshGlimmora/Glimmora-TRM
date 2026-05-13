"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  sensitive?: boolean;
  leadingAddon?: React.ReactNode;
  trailingAddon?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      invalid,
      sensitive,
      leadingAddon,
      trailingAddon,
      autoComplete,
      type = "text",
      ...rest
    },
    ref,
  ) => {
    const hasLeading = Boolean(leadingAddon);
    const hasTrailing = Boolean(trailingAddon);
    return (
      <div
        className={cn(
          "group relative flex items-stretch overflow-hidden rounded-lg border bg-surface-raised shadow-sm transition-shadow",
          invalid
            ? "border-signal-error/60 focus-within:ring-2 focus-within:ring-signal-error/25"
            : "border-line-strong focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20",
          rest.disabled && "opacity-60",
        )}
      >
        {hasLeading && (
          <span className="pointer-events-none flex items-center border-r border-line bg-surface-sunken px-3 text-xs font-medium uppercase tracking-widest text-ink-muted">
            {leadingAddon}
          </span>
        )}
        <input
          ref={ref}
          type={type}
          autoComplete={
            sensitive ? autoComplete ?? "off" : autoComplete
          }
          spellCheck={!sensitive}
          autoCorrect={sensitive ? "off" : undefined}
          autoCapitalize={sensitive ? "off" : undefined}
          aria-invalid={invalid || undefined}
          data-1p-ignore={sensitive ? "true" : undefined}
          data-lpignore={sensitive ? "true" : undefined}
          className={cn(
            sensitive && "sensitive",
            "block w-full bg-transparent px-3.5 py-2.5 text-[15px] text-ink placeholder:text-ink-subtle/80 focus:outline-none",
            hasLeading && "pl-3",
            hasTrailing && "pr-3",
            className,
          )}
          {...rest}
        />
        {hasTrailing && (
          <span className="flex items-center border-l border-line bg-surface-sunken px-3 text-xs text-ink-muted">
            {trailingAddon}
          </span>
        )}
      </div>
    );
  },
);
Input.displayName = "Input";

export interface FieldProps {
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  htmlFor?: string;
  trailingLabel?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function Field({
  label,
  hint,
  error,
  required,
  htmlFor,
  trailingLabel,
  children,
  className,
}: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={htmlFor} className="field-label">
          <span>{label}</span>
          {required && <span className="text-signal-error">*</span>}
        </label>
        {trailingLabel && (
          <span className="text-2xs font-medium text-ink-subtle">
            {trailingLabel}
          </span>
        )}
      </div>
      {children}
      {error ? (
        <p
          role="alert"
          aria-live="polite"
          className="flex items-start gap-1.5 pt-0.5 text-xs text-signal-error"
        >
          <svg
            aria-hidden
            viewBox="0 0 16 16"
            className="mt-px h-3.5 w-3.5 flex-shrink-0"
            fill="currentColor"
          >
            <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm-.75 3.25h1.5v4.5h-1.5v-4.5Zm.75 6.25a.875.875 0 1 1 0 1.75.875.875 0 0 1 0-1.75Z" />
          </svg>
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p className="pt-0.5 text-xs text-ink-subtle">{hint}</p>
      ) : null}
    </div>
  );
}
