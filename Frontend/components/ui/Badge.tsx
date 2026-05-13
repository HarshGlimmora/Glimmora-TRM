import * as React from "react";
import { cn } from "@/lib/utils/cn";

type BadgeTone =
  | "neutral"
  | "accent"
  | "success"
  | "warning"
  | "error"
  | "info"
  | "navy"
  | "seal";

type BadgeSize = "sm" | "md";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-surface-sunken text-ink-muted border-line",
  accent: "bg-accent-soft text-accent-deep border-accent/20",
  success: "bg-signal-success-soft text-signal-success border-signal-success/15",
  warning: "bg-signal-warning-soft text-signal-warning border-signal-warning/15",
  error: "bg-signal-error-soft text-signal-error border-signal-error/15",
  info: "bg-signal-info-soft text-signal-info border-signal-info/15",
  navy: "bg-navy-tint text-navy-deep border-navy/15",
  seal: "bg-seal-soft text-seal border-seal/30",
};

const SIZES: Record<BadgeSize, string> = {
  sm: "h-5 px-1.5 text-2xs tracking-widest uppercase",
  md: "h-6 px-2 text-xs",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  size?: BadgeSize;
  withDot?: boolean;
}

export function Badge({
  tone = "neutral",
  size = "sm",
  withDot,
  className,
  children,
  ...rest
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-medium",
        TONES[tone],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {withDot && (
        <span
          aria-hidden
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            tone === "success" && "bg-signal-success",
            tone === "warning" && "bg-signal-warning",
            tone === "error" && "bg-signal-error",
            tone === "info" && "bg-signal-info",
            tone === "accent" && "bg-accent",
            tone === "neutral" && "bg-ink-subtle",
            tone === "navy" && "bg-navy",
            tone === "seal" && "bg-seal",
          )}
        />
      )}
      {children}
    </span>
  );
}
