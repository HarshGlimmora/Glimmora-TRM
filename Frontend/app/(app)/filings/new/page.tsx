"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { createOrGetFiling, DEFAULT_ACTIVE_FY, listYears } from "@/lib/api/filings";

/**
 * Bridge page wired from the dashboard's "Begin filing" CTA.
 *
 * Tries to use the user's `active_tax_year` (from the workspace summary). If
 * that fails or is absent, falls back to DEFAULT_ACTIVE_FY. Posts to the
 * idempotent workspace endpoint and forwards to the documents tab.
 */
export default function NewFilingPage() {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let activeFy = DEFAULT_ACTIVE_FY;
        try {
          const list = await listYears();
          if (list.active_tax_year) activeFy = list.active_tax_year;
        } catch {
          /* fall back to default */
        }
        const filing = await createOrGetFiling({ taxYear: activeFy });
        if (cancelled) return;
        router.replace(`/filings/${filing.id}/documents`);
      } catch (e) {
        if (cancelled) return;
        setError(
          e instanceof Error
            ? e.message
            : "Could not start a filing. Please try again.",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className="grid min-h-[40vh] place-items-center">
      <div className="flex flex-col items-center gap-3 text-center">
        {error ? (
          <>
            <p className="text-sm font-medium text-error">{error}</p>
            <button
              onClick={() => router.replace("/dashboard")}
              className="text-sm text-ink-muted underline"
            >
              Back to dashboard
            </button>
          </>
        ) : (
          <>
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-navy/20 border-t-navy" />
            <p className="text-sm text-ink-muted">Opening your filing…</p>
          </>
        )}
      </div>
    </div>
  );
}
