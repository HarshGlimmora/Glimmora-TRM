"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Alert } from "@/components/ui/Alert";
import {
  createOrGetFiling,
  DEFAULT_ACTIVE_FY,
  listYears,
  type FilingDTO,
} from "@/lib/api/filings";

/**
 * Bridge page wired from the dashboard's "Begin filing" CTA.
 *
 * Behaviour:
 *   1. Use the user's `active_tax_year` from /workspace/years, else
 *      DEFAULT_ACTIVE_FY.
 *   2. Hit the idempotent POST /workspace/years/{fy}/filing.
 *   3. If a fresh draft was created or an in-progress draft / revision
 *      was returned → forward straight to the documents tab so the user
 *      can resume.
 *   4. If the returned filing is `submitted` / `in_review_by_ca` (i.e.
 *      this FY is already done from the taxpayer's side) → show a small
 *      "already filed" chooser with two CTAs:
 *         • View summary for that filing
 *         • Start filing for the next FY (FY+1)
 *      Picking the latter POSTs to the next FY's endpoint and forwards
 *      to its documents tab.
 */

type Stage =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "already_filed"; filing: FilingDTO; nextFy: string };

const RESUMABLE_STATUSES = new Set([
  "draft",
  "revision_returned",
  "revision_requested",
]);

function nextFy(fy: string): string {
  const m = /^FY(\d{4})-(\d{2})$/.exec(fy);
  if (!m) return fy;
  const start = parseInt(m[1]!, 10);
  const newStart = start + 1;
  const newEnd = (newStart + 1) % 100;
  return `FY${newStart}-${newEnd.toString().padStart(2, "0")}`;
}

function statusLabel(s: string): string {
  switch (s) {
    case "submitted":
      return "Submitted";
    case "in_review_by_ca":
      return "In CA review";
    case "accepted":
      return "Accepted";
    case "rejected":
      return "Rejected";
    case "revision_requested":
      return "Revision requested";
    case "revision_returned":
      return "Revision returned";
    default:
      return s;
  }
}

export default function NewFilingPage() {
  const router = useRouter();
  const [stage, setStage] = React.useState<Stage>({ kind: "loading" });
  const [busy, setBusy] = React.useState(false);

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

        if (RESUMABLE_STATUSES.has(filing.status)) {
          router.replace(`/filings/${filing.id}/documents`);
          return;
        }

        // Anything else is "already filed from the taxpayer's side" — the
        // canonical action is to view the summary, with an out for starting
        // the next FY.
        setStage({
          kind: "already_filed",
          filing,
          nextFy: nextFy(filing.tax_year),
        });
      } catch (e) {
        if (cancelled) return;
        setStage({
          kind: "error",
          message:
            e instanceof Error
              ? e.message
              : "Could not start a filing. Please try again.",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const handleStartNextFy = async (taxYear: string) => {
    setBusy(true);
    try {
      const filing = await createOrGetFiling({ taxYear });
      if (RESUMABLE_STATUSES.has(filing.status)) {
        router.replace(`/filings/${filing.id}/documents`);
      } else {
        // The next FY is also already filed (edge case — unlikely but possible).
        // Land on its summary and let the user move forward another year if they want.
        setStage({
          kind: "already_filed",
          filing,
          nextFy: nextFy(filing.tax_year),
        });
        setBusy(false);
      }
    } catch (e) {
      setStage({
        kind: "error",
        message:
          e instanceof Error
            ? e.message
            : "Could not open the next FY's filing.",
      });
      setBusy(false);
    }
  };

  if (stage.kind === "loading") {
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-navy/20 border-t-navy" />
          <p className="text-sm text-ink-muted">Opening your filing…</p>
        </div>
      </div>
    );
  }

  if (stage.kind === "error") {
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <div className="flex flex-col items-center gap-3 text-center">
          <Alert tone="error" title="Could not start a filing">
            {stage.message}
          </Alert>
          <Button variant="ghost" onClick={() => router.replace("/dashboard")}>
            ← Back to dashboard
          </Button>
        </div>
      </div>
    );
  }

  // stage.kind === "already_filed"
  const { filing, nextFy: next } = stage;
  return (
    <div className="mx-auto max-w-2xl py-10">
      <Card>
        <CardBody className="flex flex-col gap-5">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <Badge tone="seal" size="sm" withDot>
                {filing.tax_year}
              </Badge>
              <Badge tone="success" size="sm">
                {statusLabel(filing.status)}
              </Badge>
            </div>
            <h1 className="font-display text-2xl text-ink">
              You&apos;ve already filed {filing.tax_year}.
            </h1>
            <p className="mt-1 text-sm text-ink-muted text-pretty">
              Your return is{" "}
              <strong className="text-ink">
                {statusLabel(filing.status).toLowerCase()}
              </strong>
              . You can review the summary you submitted, or jump ahead and
              start filing for the next financial year.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              onClick={() => router.replace(`/filings/${filing.id}/summary`)}
              disabled={busy}
            >
              View summary
            </Button>
            <Button
              variant="outline"
              onClick={() => void handleStartNextFy(next)}
              loading={busy}
              disabled={busy}
            >
              Start filing for {next} →
            </Button>
            <Button
              variant="ghost"
              onClick={() => router.replace("/dashboard")}
              disabled={busy}
            >
              Back to dashboard
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
