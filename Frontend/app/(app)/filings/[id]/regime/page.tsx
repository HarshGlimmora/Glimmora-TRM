"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { RegimeCards } from "@/components/filings/RegimeCards";
import { Section115BACModal } from "@/components/filings/Section115BACModal";
import { useFiling } from "@/lib/filings/context";
import {
  calculate,
  precheckRegime,
  sha256Hex,
  type CalculateResponse,
  type PrecheckResponse,
  type Regime,
} from "@/lib/api/regime";
import { getProgress } from "@/lib/api/transactions";

export default function FilingRegimePage() {
  const router = useRouter();
  const { filing, refresh: refreshFiling } = useFiling();

  const [preview, setPreview] = React.useState<CalculateResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [transactionsComplete, setTransactionsComplete] = React.useState<boolean | null>(null);

  const [selected, setSelected] = React.useState<Regime | null>(null);
  const [committingRegime, setCommittingRegime] = React.useState<Regime | null>(null);
  const [banner, setBanner] = React.useState<{
    tone: "info" | "success" | "warning" | "error";
    title: string;
    message: string;
  } | null>(null);

  const [precheck, setPrecheck] = React.useState<PrecheckResponse | null>(null);
  const [modalOpen, setModalOpen] = React.useState(false);

  // Load both-regimes preview + verify-progress guard once on mount.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [calc, progress] = await Promise.all([
          calculate(filing.id, { regime: "both" }),
          getProgress(filing.id),
        ]);
        if (cancelled) return;
        setPreview(calc);
        setTransactionsComplete(progress.total > 0 && progress.unverified === 0);
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "Could not load regime preview.";
        setError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filing.id]);

  const commit = React.useCallback(
    async (
      regime: Regime,
      ackOpts?: { acknowledged: boolean; hash: string },
    ) => {
      setCommittingRegime(regime);
      try {
        const body: Parameters<typeof calculate>[1] = { regime };
        if (ackOpts) {
          body.acknowledged_regime_switch = ackOpts.acknowledged;
          body.acknowledgment_text_hash = ackOpts.hash;
        }
        const result = await calculate(filing.id, body);
        // Refresh the in-context filing so the layout shows the committed regime.
        await refreshFiling();
        // The single-regime response only populates one side; keep the other
        // pre-existing card visible by merging into the existing preview.
        setPreview((prev) =>
          prev
            ? {
                ...prev,
                old_regime: result.old_regime ?? prev.old_regime,
                new_regime: result.new_regime ?? prev.new_regime,
                recommended_regime: prev.recommended_regime,
              }
            : result,
        );
        setSelected(regime);
        setBanner({
          tone: "success",
          title: `${regime === "new" ? "New" : "Old"} regime saved`,
          message:
            "Your regime choice is recorded. You can change it any time before submission.",
        });
        return true;
      } catch (e) {
        const code = (e as Error & { code?: string }).code ?? "";
        const message = e instanceof Error ? e.message : "Could not save regime.";
        if (code === "regime_switch_blocked") {
          setBanner({
            tone: "error",
            title: "Switch not permitted",
            message,
          });
        } else if (code === "regime_acknowledgment_hash_mismatch") {
          setBanner({
            tone: "error",
            title: "Acknowledgment mismatch",
            message:
              "The acknowledgment text did not match exactly. Re-open the modal and try again.",
          });
        } else {
          setBanner({ tone: "error", title: "Save failed", message });
        }
        return false;
      } finally {
        setCommittingRegime(null);
      }
    },
    [filing.id, refreshFiling],
  );

  const handleSelect = React.useCallback(
    async (regime: Regime) => {
      setBanner(null);
      setSelected(regime);

      let check: PrecheckResponse;
      try {
        check = await precheckRegime(filing.id, regime);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Precheck failed.";
        setBanner({ tone: "error", title: "Precheck failed", message });
        setSelected(null);
        return;
      }

      setPrecheck(check);

      if (check.level === "BLOCK") {
        setBanner({
          tone: "error",
          title: "Section 115BAC(6) — lifetime lock",
          message:
            check.message ??
            "You have already used your one-time lifetime switch.",
        });
        setSelected(null);
        return;
      }

      if (check.level === "INFO" && check.message) {
        setBanner({
          tone: "info",
          title: "Regime switch",
          message: check.message,
        });
      }

      if (check.level === "WARN_HIGH") {
        setModalOpen(true);
        return;
      }

      // OK / INFO → commit immediately.
      await commit(regime);
    },
    [filing.id, commit],
  );

  const handleAcknowledge = React.useCallback(
    async (acknowledgmentText: string) => {
      if (!selected) return;
      const hash = await sha256Hex(acknowledgmentText);
      const ok = await commit(selected, { acknowledged: true, hash });
      if (ok) {
        setModalOpen(false);
        setPrecheck(null);
      }
    },
    [selected, commit],
  );

  const committed: Regime | null =
    filing.regime_used === "old" || filing.regime_used === "new"
      ? (filing.regime_used as Regime)
      : null;

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle>Choose your tax regime</CardTitle>
          <CardDescription>
            Both regimes are computed from your verified transactions. Pick the
            one you want to file under — you can change it any time before
            submission.
          </CardDescription>
        </CardHeader>
        <CardBody className="flex flex-col gap-4">
          {transactionsComplete === false && (
            <Alert tone="warning" title="Some transactions are still unverified">
              You can preview both regimes, but verify every transaction in the
              Transactions tab before submitting your return.
            </Alert>
          )}

          {banner && (
            <Alert tone={banner.tone} title={banner.title}>
              {banner.message}
            </Alert>
          )}

          {loading ? (
            <div className="grid min-h-[20vh] place-items-center">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-navy/20 border-t-navy" />
            </div>
          ) : error ? (
            <Alert tone="error" title="Could not load regime preview">
              {error}
            </Alert>
          ) : preview ? (
            <RegimeCards
              oldRegime={preview.old_regime}
              newRegime={preview.new_regime}
              recommended={preview.recommended_regime}
              savings={preview.savings}
              committed={committed}
              selected={selected}
              onSelect={handleSelect}
              disabled={committingRegime !== null}
            />
          ) : null}

          <div className="flex items-center justify-between border-t border-line-subtle pt-4">
            <Button
              variant="ghost"
              onClick={() => router.push(`/filings/${filing.id}/transactions`)}
            >
              ← Back to transactions
            </Button>
            <Button
              onClick={() => router.push(`/filings/${filing.id}/summary`)}
              disabled={committed === null}
            >
              Continue to summary →
            </Button>
          </div>
        </CardBody>
      </Card>

      <Section115BACModal
        open={modalOpen}
        precheck={precheck}
        filingYear={filing.tax_year}
        busy={committingRegime !== null}
        onCancel={() => {
          if (committingRegime) return;
          setModalOpen(false);
          setPrecheck(null);
          setSelected(null);
        }}
        onAcknowledge={handleAcknowledge}
      />
    </div>
  );
}
