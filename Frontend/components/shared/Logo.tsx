import * as React from "react";
import { cn } from "@/lib/utils/cn";

interface LogoProps extends React.HTMLAttributes<HTMLSpanElement> {
  size?: "sm" | "md" | "lg";
  withWordmark?: boolean;
  inverse?: boolean;
}

const SIZE_MAP = {
  sm: { mark: "h-6 w-6", text: "text-sm" },
  md: { mark: "h-8 w-8", text: "text-base" },
  lg: { mark: "h-10 w-10", text: "text-lg" },
};

export function Logo({
  size = "md",
  withWordmark = true,
  inverse,
  className,
  ...rest
}: LogoProps) {
  const s = SIZE_MAP[size];
  return (
    <span
      className={cn("inline-flex items-center gap-2.5", className)}
      {...rest}
    >
      <span
        className={cn(
          "relative inline-flex items-center justify-center overflow-hidden rounded-md",
          s.mark,
          inverse ? "bg-white text-navy-deep" : "bg-navy text-white",
        )}
        aria-hidden
      >
        <svg
          viewBox="0 0 32 32"
          fill="none"
          className="h-[68%] w-[68%]"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {/* Stylised "G" reading as a sovereign seal */}
          <path d="M22 9.5A8 8 0 1 0 16 24a8 8 0 0 0 8-8" />
          <path d="M22 16h-5" />
        </svg>
        <span
          aria-hidden
          className={cn(
            "absolute inset-0 ring-1 ring-inset rounded-md",
            inverse ? "ring-navy/20" : "ring-white/15",
          )}
        />
      </span>
      {withWordmark && (
        <span className={cn("flex items-baseline gap-1.5", s.text)}>
          <span
            className={cn(
              "font-semibold tracking-[-0.01em]",
              inverse ? "text-white" : "text-ink",
            )}
          >
            Glimmora
          </span>
          <span
            className={cn(
              "rounded-sm border px-1 py-px text-2xs font-medium uppercase tracking-widest",
              inverse
                ? "border-white/30 text-white/80"
                : "border-navy/20 text-navy",
            )}
          >
            TRM
          </span>
        </span>
      )}
    </span>
  );
}
