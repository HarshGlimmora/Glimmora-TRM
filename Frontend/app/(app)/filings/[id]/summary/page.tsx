"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { SummaryPanel } from "@/components/filings/SummaryPanel";
import { CalculationTraceAccordion } from "@/components/filings/CalculationTraceAccordion";
import { useFiling } from "@/lib/filings/context";
import {
  downloadSummaryPdf,
  explainCalculationTrace,
  getSummary,
  type ExplainStepDTO,
  type SummaryDTO,
} from "@/lib/api/summary";

export default function FilingSummaryPage() {
  const router = useRouter();
  const { filing } = useFiling();
  const [summary, setSummary] = React.useState<SummaryDTO | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<{ code: string; message: string } | null>(null);
  const [downloading, setDownloading] = React.useState(false);
  const [downloadError, setDownloadError] = React.useState<string | null>(null);
  const [explanations, setExplanations] = React.useState<ExplainStepDTO[]>([]);
  const [explainLoading, setExplainLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await getSummary(filing.id);
        if (!cancelled) setSummary(data);
      } catch (e) {
        if (cancelled) return;
        const code = (e as Error & { code?: string }).code ?? "summary_load_failed";
        const message = e instanceof Error ? e.message : "Could not load summary.";
        setError({ code, message });
      } finally {
        if (!cancelled) setLoading(false);
      }

      // Fetch explanations in parallel — they're slower (LLM round-trip) so
      // we don't block the summary cards on them.
      setExplainLoading(true);
      try {
        const trace = await explainCalculationTrace(filing.id);
        if (!cancelled) setExplanations(trace.explanations);
      } catch {
        // Non-fatal: the accordion falls back to step.human_explanation.
        if (!cancelled) setExplanations([]);
      } finally {
        if (!cancelled) setExplainLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filing.id]);

  const handleDownload = async () => {
    setDownloading(true);
    setDownloadError(null);
    try {
      await downloadSummaryPdf(filing.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not download PDF.";
      setDownloadError(msg);
    } finally {
      setDownloading(false);
    }
  };

  if (loading) {
    return (
      <div className="grid min-h-[30vh] place-items-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-navy/20 border-t-navy" />
      </div>
    );
  }

  if (error) {
    if (error.code === "filing_not_ready_for_summary") {
      return (
        <Card>
          <CardHeader>
            <CardTitle>Summary not ready yet</CardTitle>
            <CardDescription>
              Pick a tax regime on the Regime tab before opening the summary.
            </CardDescription>
          </CardHeader>
          <CardBody>
            <Button onClick={() => router.push(`/filings/${filing.id}/regime`)}>
              Go to Regime →
            </Button>
          </CardBody>
        </Card>
      );
    }
    return (
      <Alert tone="error" title="Could not load summary">
        {error.message}
      </Alert>
    );
  }

  if (!summary) return null;

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Tax summary</CardTitle>
              <CardDescription>
                Final recap for FY {summary.tax_year} ·{" "}
                <Badge tone="seal" size="sm" withDot>
                  {summary.regime_used.toUpperCase()} regime
                </Badge>{" "}
                · {summary.statute}. Every number here matches the trace below
                and the PDF — they all flow from the same computation.
              </CardDescription>
            </div>
            <div className="flex flex-col items-end gap-2">
              <Button
                onClick={handleDownload}
                loading={downloading}
                disabled={downloading}
              >
                Download PDF
              </Button>
              {downloadError && (
                <p className="max-w-xs text-right text-xs text-signal-error">
                  {downloadError}
                </p>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>

      <SummaryPanel summary={summary} />

      <CalculationTraceAccordion
        trace={summary.calculation_trace}
        explanations={explanations}
        loading={explainLoading}
      />

      <div className="flex items-center justify-between border-t border-line-subtle pt-4">
        <Button
          variant="ghost"
          onClick={() => router.push(`/filings/${filing.id}/regime`)}
        >
          ← Back to regime
        </Button>
        <Button onClick={() => router.push(`/filings/${filing.id}/submit`)}>
          Continue to submit →
        </Button>
      </div>
    </div>
  );
}
