"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";

// `enabled: false` tabs are placeholders until their owning step ships
// (Submit = Step 7).
const TABS = [
  { key: "documents", label: "Documents", enabled: true },
  { key: "transactions", label: "Transactions", enabled: true },
  { key: "regime", label: "Regime", enabled: true },
  { key: "summary", label: "Summary", enabled: true },
  { key: "submit", label: "Submit", enabled: false },
] as const;

export function FilingTabs({ filingId }: { filingId: string }) {
  const pathname = usePathname();
  return (
    <nav
      className="flex gap-1 border-b border-line"
      aria-label="Filing sections"
    >
      {TABS.map((t) => {
        const href = `/filings/${filingId}/${t.key}`;
        const active = pathname?.startsWith(href);
        const baseClass = cn(
          "relative px-4 py-2.5 text-sm transition-colors",
          active
            ? "font-semibold text-ink"
            : t.enabled
              ? "text-ink-muted hover:text-ink"
              : "cursor-not-allowed text-ink-subtle",
        );
        const indicator = active && (
          <span
            aria-hidden
            className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-navy"
          />
        );
        if (!t.enabled) {
          return (
            <span
              key={t.key}
              className={baseClass}
              aria-disabled="true"
              title="Available in a later step"
            >
              {t.label}
              {indicator}
            </span>
          );
        }
        return (
          <Link
            key={t.key}
            href={href}
            className={baseClass}
            aria-current={active ? "page" : undefined}
          >
            {t.label}
            {indicator}
          </Link>
        );
      })}
    </nav>
  );
}
