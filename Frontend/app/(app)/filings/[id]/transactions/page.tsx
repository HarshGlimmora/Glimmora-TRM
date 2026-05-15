"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { TxnTable } from "@/components/filings/TxnTable";
import { TxnEditDrawer } from "@/components/filings/TxnEditDrawer";
import { VerifyProgressBar } from "@/components/filings/VerifyProgressBar";
import { useFiling } from "@/lib/filings/context";
import {
  getProgress,
  listTransactions,
  verifyAllTransactions,
  verifyTransaction,
  type CategorizationMethod,
  type TransactionDTO,
  type TxnListQuery,
  type TxnProgress,
} from "@/lib/api/transactions";

export default function FilingTransactionsPage() {
  const router = useRouter();
  const { filing } = useFiling();
  const [txns, setTxns] = React.useState<TransactionDTO[]>([]);
  const [total, setTotal] = React.useState(0);
  const [progress, setProgress] = React.useState<TxnProgress | null>(null);
  const [filters, setFilters] = React.useState<TxnListQuery>({
    status: "all",
    page: 1,
    limit: 50,
  });
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [editTxn, setEditTxn] = React.useState<TransactionDTO | null>(null);
  const [busyTxnId, setBusyTxnId] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, prog] = await Promise.all([
        listTransactions(filing.id, filters),
        getProgress(filing.id),
      ]);
      setTxns(list.items);
      setTotal(list.meta.total);
      setProgress(prog);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load transactions.");
    } finally {
      setLoading(false);
    }
  }, [filing.id, filters]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleVerifySingle = async (txn: TransactionDTO) => {
    setBusyTxnId(txn.id);
    try {
      await verifyTransaction(filing.id, txn.id);
      await refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Verify failed.");
    } finally {
      setBusyTxnId(null);
    }
  };

  const handleVerifyAll = async (filter: { method?: CategorizationMethod }) => {
    try {
      const result = await verifyAllTransactions(filing.id, filter);
      if (result.verified === 0) {
        alert("Nothing to verify under this filter.");
      }
      await refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Bulk verify failed.");
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle>Review transactions</CardTitle>
          <CardDescription>
            Every row must be verified before regime / submit. RULE rows came
            from the deterministic categoriser, AI rows from Gemini, MANUAL
            from your own edits. Editing any row demotes it to MANUAL.
          </CardDescription>
        </CardHeader>
        <CardBody className="flex flex-col gap-4">
          {progress && <VerifyProgressBar progress={progress} />}
          <div className="flex items-center justify-end border-t border-line-subtle pt-3">
            <Button
              onClick={() => router.push(`/filings/${filing.id}/regime`)}
              disabled={!progress || progress.total === 0 || progress.unverified > 0}
              title={
                !progress || progress.total === 0
                  ? "Upload documents first."
                  : progress.unverified > 0
                    ? "Verify every row before continuing."
                    : undefined
              }
            >
              Continue to regime →
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="flex flex-col gap-3">
          {loading && txns.length === 0 ? (
            <div className="grid min-h-[20vh] place-items-center">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-navy/20 border-t-navy" />
            </div>
          ) : (
            <TxnTable
              txns={txns}
              total={total}
              filters={filters}
              handlers={{
                onVerifySingle: handleVerifySingle,
                onVerifyAll: handleVerifyAll,
                onEdit: (t) => setEditTxn(t),
                onFiltersChange: setFilters,
                busyTxnId,
              }}
            />
          )}
          {error && <p className="text-sm text-signal-error">{error}</p>}
        </CardBody>
      </Card>

      <TxnEditDrawer
        open={editTxn !== null}
        filingId={filing.id}
        txn={editTxn}
        onClose={() => setEditTxn(null)}
        onSaved={(updated) => {
          setTxns((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
          setEditTxn(null);
          // Refresh so the progress bar updates if status changed.
          void refresh();
        }}
      />
    </div>
  );
}
