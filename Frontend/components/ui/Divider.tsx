import * as React from "react";
import { cn } from "@/lib/utils/cn";

export function Divider({
  className,
  vertical,
  label,
}: {
  className?: string;
  vertical?: boolean;
  label?: React.ReactNode;
}) {
  if (label) {
    return (
      <div
        role="separator"
        className={cn(
          "flex items-center gap-3 text-2xs font-medium uppercase tracking-widest text-ink-subtle",
          className,
        )}
      >
        <span className="h-px flex-1 bg-line" />
        <span>{label}</span>
        <span className="h-px flex-1 bg-line" />
      </div>
    );
  }
  return (
    <div
      role="separator"
      aria-orientation={vertical ? "vertical" : "horizontal"}
      className={cn(
        vertical ? "h-full w-px bg-line" : "h-px w-full bg-line",
        className,
      )}
    />
  );
}
