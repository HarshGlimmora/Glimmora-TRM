"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { FilingStepper, type FilingStepKey } from "@/components/filings/FilingStepper";
import { FilingTabs } from "@/components/filings/FilingTabs";
import { getYearBundle, type FilingDTO } from "@/lib/api/filings";
import { FilingContext } from "@/lib/filings/context";

/**
 * Filing shell — loads the filing once and exposes it to step pages via
 * a lightweight React context. AuthGuard is inherited from (app)/layout.tsx.
 */

function stepFromPath(pathname: string | null, filingId: string): FilingStepKey {
  if (!pathname) return "documents";
  const tail = pathname.replace(`/filings/${filingId}`, "").replace(/^\//, "").split("/")[0];
  switch (tail) {
    case "transactions":
    case "regime":
    case "summary":
    case "submit":
      return tail;
    default:
      return "documents";
  }
}

export default function FilingLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { id: string };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const filingId = params.id;
  const [filing, setFiling] = React.useState<FilingDTO | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      // We don't yet know the tax_year from the URL — discover it by hitting
      // the FY-by-id endpoint via a small inline call. The current backend
      // exposes the filing inside `/workspace/years/{fy}`, so we use a one-off
      // PATCH-style lookup: ask each known year. Simpler MVP: fetch the list
      // of years the user has and find the one matching this id.
      const { listYears } = await import("@/lib/api/filings");
      const list = await listYears();
      const match = list.items.find((it) => it.filing_id === filingId);
      if (!match) {
        setError("Filing not found.");
        return;
      }
      const bundle = await getYearBundle(match.tax_year);
      if (!bundle.filing || bundle.filing.id !== filingId) {
        setError("Filing not found.");
        return;
      }
      setFiling(bundle.filing);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load filing.");
    }
  }, [filingId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <Card>
        <CardBody className="flex flex-col items-start gap-3">
          <p className="text-sm font-medium text-error">{error}</p>
          <button
            onClick={() => router.replace("/dashboard")}
            className="text-sm text-ink-muted underline"
          >
            Back to dashboard
          </button>
        </CardBody>
      </Card>
    );
  }

  if (!filing) {
    return (
      <div className="grid min-h-[30vh] place-items-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-navy/20 border-t-navy" />
      </div>
    );
  }

  const activeStep = stepFromPath(pathname, filingId);

  return (
    <FilingContext.Provider value={{ filing, refresh: load }}>
      <div className="flex flex-col gap-6 animate-fade-up">
        <header className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <h1 className="font-display text-3xl text-ink">Filing</h1>
            <Badge tone="seal" size="sm" withDot>
              {filing.tax_year}
            </Badge>
            <Badge tone="neutral" size="sm">
              {filing.status}
            </Badge>
          </div>
          <p className="text-sm text-ink-muted">
            Every field on this filing is editable. Rules decide, AI assists,
            you confirm.
          </p>
        </header>

        <Card>
          <CardBody>
            <FilingStepper active={activeStep} />
          </CardBody>
        </Card>

        <FilingTabs filingId={filing.id} />

        <div>{children}</div>
      </div>
    </FilingContext.Provider>
  );
}
