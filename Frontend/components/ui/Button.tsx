"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-navy text-white hover:bg-navy-deep active:bg-navy-deep focus-visible:bg-navy-deep disabled:bg-line-strong disabled:text-ink-subtle",
  secondary:
    "bg-surface-raised text-ink border border-line-strong hover:bg-surface-sunken active:bg-surface-sunken disabled:bg-surface-sunken disabled:text-ink-subtle",
  outline:
    "bg-transparent text-navy border border-navy/30 hover:bg-navy-tint hover:border-navy active:bg-navy-tint disabled:text-ink-subtle disabled:border-line",
  ghost:
    "bg-transparent text-ink hover:bg-surface-sunken active:bg-surface-sunken disabled:text-ink-subtle",
  danger:
    "bg-signal-error text-white hover:bg-signal-error/90 active:bg-signal-error/90 disabled:bg-signal-error/40",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-sm rounded-md gap-1.5",
  md: "h-11 px-4 text-sm rounded-lg gap-2",
  lg: "h-12 px-5 text-[15px] rounded-lg gap-2",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      loading,
      disabled,
      leftIcon,
      rightIcon,
      fullWidth,
      className,
      children,
      type = "button",
      ...rest
    },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={cn(
          "relative inline-flex items-center justify-center whitespace-nowrap font-medium tracking-[-0.005em] transition-[background-color,color,border-color,box-shadow] duration-150",
          "disabled:cursor-not-allowed select-none",
          fullWidth && "w-full",
          VARIANTS[variant],
          SIZES[size],
          className,
        )}
        {...rest}
      >
        {loading && (
          <span
            aria-hidden="true"
            className="absolute inline-flex h-4 w-4 items-center justify-center"
          >
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          </span>
        )}
        <span
          className={cn(
            "inline-flex items-center gap-2",
            loading && "opacity-0",
          )}
        >
          {leftIcon}
          {children}
          {rightIcon}
        </span>
      </button>
    );
  },
);
Button.displayName = "Button";
