"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils/cn";

export interface PreconditionItem {
  id: string;
  label: string;
  status: "ok" | "blocked" | "pending";
  detail?: string;
  /** Optional link to the page that fixes this. */
  fixHref?: string;
  fixLabel?: string;
}

interface Props {
  items: PreconditionItem[];
}

function Icon({ status }: { status: PreconditionItem["status"] }) {
  if (status === "ok") {
    return (
      <span
        aria-hidden
        className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-signal-success text-white"
      >
        <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 8.5l3 3 7-7" />
        </svg>
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span
        aria-hidden
        className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-surface-sunken text-ink-muted"
      >
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-signal-error text-white"
    >
      <svg viewBox="0 0 16 16" className="h-3 w-3" fill="currentColor">
        <path d="M4.7 4.7a1 1 0 0 1 1.4 0L8 6.6l1.9-1.9a1 1 0 1 1 1.4 1.4L9.4 8l1.9 1.9a1 1 0 0 1-1.4 1.4L8 9.4l-1.9 1.9a1 1 0 0 1-1.4-1.4L6.6 8 4.7 6.1a1 1 0 0 1 0-1.4Z" />
      </svg>
    </span>
  );
}

export function SubmitPreconditions({ items }: Props) {
  return (
    <ul className="flex flex-col divide-y divide-line-subtle rounded-lg border border-line bg-surface-raised">
      {items.map((it) => (
        <li
          key={it.id}
          className="flex flex-wrap items-start gap-3 px-4 py-3"
        >
          <Icon status={it.status} />
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                "text-sm font-medium",
                it.status === "blocked" ? "text-ink" : "text-ink",
              )}
            >
              {it.label}
            </p>
            {it.detail && (
              <p className="mt-0.5 text-xs text-ink-muted">{it.detail}</p>
            )}
          </div>
          {it.status === "blocked" && it.fixHref && (
            <Link
              href={it.fixHref}
              className="shrink-0 text-sm text-navy underline-offset-2 hover:underline"
            >
              {it.fixLabel ?? "Fix"} →
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}
