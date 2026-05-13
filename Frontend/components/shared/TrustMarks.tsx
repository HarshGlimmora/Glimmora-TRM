import * as React from "react";
import { cn } from "@/lib/utils/cn";

const ITEMS: { label: string; icon: React.ReactNode }[] = [
  {
    label: "Aadhaar-grade encryption",
    icon: (
      <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
        <path d="M8 1.5a4 4 0 0 0-4 4v1.6h-.5A1.5 1.5 0 0 0 2 8.6v4.4A1.5 1.5 0 0 0 3.5 14.5h9A1.5 1.5 0 0 0 14 13V8.6a1.5 1.5 0 0 0-1.5-1.5H12V5.5a4 4 0 0 0-4-4Zm-2.5 5.6V5.5a2.5 2.5 0 1 1 5 0v1.6h-5Z" />
      </svg>
    ),
  },
  {
    label: "Audit-traceable actions",
    icon: (
      <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
        <path d="M3 2a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V5.5L10.5 2H3Zm6.75 5.25 1.5 1.5L7.75 12 5 9.25l1.06-1.06L7.75 9.88l3-2.63h-1Z" />
      </svg>
    ),
  },
  {
    label: "Consent-gated data flow",
    icon: (
      <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
        <path d="M8 1.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13Zm3.78 5.03a.75.75 0 0 0-1.06-1.06L7 9.19 5.28 7.47a.75.75 0 0 0-1.06 1.06l2.25 2.25c.3.29.77.29 1.06 0l3.5-3.5Z" />
      </svg>
    ),
  },
  {
    label: "DPDP-aligned handling",
    icon: (
      <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
        <path d="M8 1.25c-2.5 0-4.5 1-6 2.25v5C2 12.5 5 14.5 8 14.75c3-.25 6-2.25 6-6.25v-5c-1.5-1.25-3.5-2.25-6-2.25Zm0 1.6c1.9 0 3.5.75 4.5 1.5v3.9c0 2.85-2.1 4.5-4.5 4.7-2.4-.2-4.5-1.85-4.5-4.7v-3.9c1-.75 2.6-1.5 4.5-1.5Z" />
      </svg>
    ),
  },
];

export function TrustMarks({
  className,
  variant = "row",
}: {
  className?: string;
  variant?: "row" | "stack";
}) {
  return (
    <ul
      className={cn(
        "list-none",
        variant === "row"
          ? "flex flex-wrap items-center gap-x-5 gap-y-2"
          : "grid gap-2",
        className,
      )}
    >
      {ITEMS.map((it) => (
        <li
          key={it.label}
          className="flex items-center gap-2 text-2xs font-medium uppercase tracking-widest text-ink-subtle"
        >
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-surface-sunken text-navy/70">
            {it.icon}
          </span>
          {it.label}
        </li>
      ))}
    </ul>
  );
}
