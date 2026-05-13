import * as React from "react";
import { cn } from "@/lib/utils/cn";

/** A label/tag for filterable attributes — visually distinct from Badge. */
export function Tag({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-surface-raised px-2 py-0.5 text-xs font-medium text-ink-muted",
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
