import * as React from "react";
import { cn } from "@/lib/utils/cn";

type AlertTone = "info" | "success" | "warning" | "error" | "neutral";

const TONES: Record<
  AlertTone,
  { wrap: string; icon: React.ReactNode; iconWrap: string }
> = {
  info: {
    wrap: "border-signal-info/20 bg-signal-info-soft text-signal-info",
    iconWrap: "bg-signal-info text-white",
    icon: (
      <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
        <path d="M8 1.5a6.5 6.5 0 1 0 0 13A6.5 6.5 0 0 0 8 1.5Zm.75 9.75h-1.5v-4.5h1.5v4.5ZM8 5.5a.875.875 0 1 1 0-1.75.875.875 0 0 1 0 1.75Z" />
      </svg>
    ),
  },
  success: {
    wrap: "border-signal-success/20 bg-signal-success-soft text-signal-success",
    iconWrap: "bg-signal-success text-white",
    icon: (
      <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
        <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-6.5 6.5a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 1 1 1.06-1.06L6.75 10.19l5.97-5.97a.75.75 0 0 1 1.06 0Z" />
      </svg>
    ),
  },
  warning: {
    wrap: "border-signal-warning/20 bg-signal-warning-soft text-signal-warning",
    iconWrap: "bg-signal-warning text-white",
    icon: (
      <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
        <path d="M7.13 1.93a1 1 0 0 1 1.74 0l6.04 10.5A1 1 0 0 1 14.04 14H1.96a1 1 0 0 1-.87-1.57l6.04-10.5ZM8 5.25a.75.75 0 0 0-.75.75v3a.75.75 0 0 0 1.5 0V6A.75.75 0 0 0 8 5.25Zm0 6.5a.875.875 0 1 0 0-1.75.875.875 0 0 0 0 1.75Z" />
      </svg>
    ),
  },
  error: {
    wrap: "border-signal-error/25 bg-signal-error-soft text-signal-error",
    iconWrap: "bg-signal-error text-white",
    icon: (
      <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
        <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm-.75 3.25h1.5v4.5h-1.5v-4.5Zm.75 6.25a.875.875 0 1 1 0 1.75.875.875 0 0 1 0-1.75Z" />
      </svg>
    ),
  },
  neutral: {
    wrap: "border-line bg-surface-sunken text-ink",
    iconWrap: "bg-navy text-white",
    icon: (
      <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
        <path d="M8 1.5a6.5 6.5 0 1 0 0 13A6.5 6.5 0 0 0 8 1.5Zm.75 9.75h-1.5v-4.5h1.5v4.5ZM8 5.5a.875.875 0 1 1 0-1.75.875.875 0 0 1 0 1.75Z" />
      </svg>
    ),
  },
};

export interface AlertProps {
  tone?: AlertTone;
  title?: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
}

export function Alert({
  tone = "info",
  title,
  children,
  action,
  className,
  compact,
}: AlertProps) {
  const t = TONES[tone];
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex w-full items-start gap-3 rounded-lg border px-4 py-3",
        t.wrap,
        compact && "px-3 py-2",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "mt-0.5 inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full",
          t.iconWrap,
        )}
      >
        {t.icon}
      </span>
      <div className="flex-1">
        {title && (
          <div className="text-sm font-semibold tracking-[-0.005em]">
            {title}
          </div>
        )}
        {children && (
          <div className={cn("text-sm/relaxed", title && "mt-0.5 opacity-90")}>
            {children}
          </div>
        )}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}
