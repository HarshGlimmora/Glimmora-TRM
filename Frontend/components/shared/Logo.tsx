import * as React from "react";
import Image from "next/image";
import { cn } from "@/lib/utils/cn";

interface LogoProps extends React.HTMLAttributes<HTMLSpanElement> {
  size?: "sm" | "md" | "lg";
  /** Kept for API compatibility; the brand lockup PNG already includes the wordmark. */
  withWordmark?: boolean;
  /** Kept for API compatibility; supply a white-on-dark variant later if needed. */
  inverse?: boolean;
}

const SIZE_MAP = {
  sm: "h-10",
  md: "h-14",
  lg: "h-20",
};

export function Logo({
  size = "md",
  withWordmark: _withWordmark = true,
  inverse: _inverse,
  className,
  ...rest
}: LogoProps) {
  return (
    <span
      className={cn("inline-flex items-center", className)}
      {...rest}
    >
      <Image
        src="/glimmoratax-logo.png"
        alt="Glimmora Tax"
        width={3082}
        height={835}
        priority
        quality={95}
        className={cn("w-auto", SIZE_MAP[size])}
      />
    </span>
  );
}
