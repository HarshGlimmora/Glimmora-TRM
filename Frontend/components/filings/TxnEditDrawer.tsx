"use client";

import * as React from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import {
  putTransaction,
  type TransactionDTO,
  type TxnStatus,
} from "@/lib/api/transactions";

/**
 * Edit drawer for a single transaction. Per spec: any user edit demotes the
 * row to `categorization_method='manual'` and `routing_method='manual_override'`
 * — that demotion happens server-side; the UI just reflects the returned
 * shape on save.
 */
export function TxnEditDrawer({
  open,
  filingId,
  txn,
  onClose,
  onSaved,
}: {
  open: boolean;
  filingId: string;
  txn: TransactionDTO | null;
  onClose: () => void;
  onSaved: (updated: TransactionDTO) => void;
}) {
  const [draft, setDraft] = React.useState<{
    description: string;
    category: string;
    amount: string;
    txn_date: string;
    tax_year: string;
    counterparty: string;
    status: TxnStatus;
  }>({
    description: "",
    category: "",
    amount: "",
    txn_date: "",
    tax_year: "",
    counterparty: "",
    status: "unverified",
  });
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open || !txn) return;
    setDraft({
      description: txn.description ?? "",
      category: txn.category ?? "",
      amount: txn.amount,
      txn_date: txn.txn_date,
      tax_year: txn.tax_year,
      counterparty: txn.counterparty ?? "",
      status: txn.status,
    });
    setReason("");
    setError(null);
  }, [open, txn]);

  if (!txn) return null;

  const handleSave = async () => {
    setBusy(true);
    setError(null);
    try {
      const updated = await putTransaction(filingId, txn.id, {
        description: draft.description.trim() || undefined,
        category: draft.category.trim() || undefined,
        amount: draft.amount.trim() || undefined,
        txn_date: draft.txn_date.trim() || undefined,
        tax_year: draft.tax_year.trim() || undefined,
        counterparty: draft.counterparty.trim() || undefined,
        status: draft.status,
        reason: reason.trim() || undefined,
      });
      onSaved(updated);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save edits.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title="Edit transaction"
      description="Editing demotes this row to MANUAL classification and stamps an audit entry."
      size="lg"
      footer={
        <>
          <Button type="button" variant="ghost" size="md" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" variant="primary" size="md" onClick={handleSave} loading={busy} disabled={busy}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          <Badge tone="neutral" size="sm">
            id: <span className="font-mono">{txn.id.slice(0, 8)}…</span>
          </Badge>
          <Badge tone="info" size="sm">
            source: {txn.categorization_method}
          </Badge>
          <Badge tone="neutral" size="sm">
            routing: {txn.routing_method}
          </Badge>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Date (YYYY-MM-DD)">
            <input
              type="date"
              value={draft.txn_date}
              onChange={(e) => setDraft({ ...draft, txn_date: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label="Financial year">
            <input
              type="text"
              value={draft.tax_year}
              onChange={(e) =>
                setDraft({ ...draft, tax_year: e.target.value.toUpperCase().trim() })
              }
              placeholder="FY2024-25"
              className={`${inputCls} font-mono`}
            />
          </Field>
          <Field label="Amount (signed, ₹)">
            <input
              type="text"
              inputMode="decimal"
              value={draft.amount}
              onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
              className={`${inputCls} font-mono tabular-nums`}
            />
          </Field>
          <Field label="Category">
            <input
              type="text"
              value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value })}
              placeholder="salary / rent_paid / interest_fd / …"
              className={inputCls}
            />
          </Field>
          <Field label="Description" className="sm:col-span-2">
            <input
              type="text"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label="Counterparty hint">
            <input
              type="text"
              value={draft.counterparty}
              onChange={(e) => setDraft({ ...draft, counterparty: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label="Status">
            <select
              value={draft.status}
              onChange={(e) => setDraft({ ...draft, status: e.target.value as TxnStatus })}
              className={inputCls}
            >
              <option value="unverified">unverified</option>
              <option value="verified">verified</option>
              <option value="rejected">rejected</option>
            </select>
          </Field>
        </div>

        <Field label="Reason (optional, audit trail)">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Why are you editing this row?"
            className={`${inputCls} h-auto py-2`}
          />
        </Field>

        {error && <p className="text-sm text-signal-error">{error}</p>}
      </div>
    </Modal>
  );
}

const inputCls =
  "h-9 w-full rounded-md border border-line bg-surface-raised px-3 text-sm focus:border-navy focus:outline-none";

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1 ${className ?? ""}`}>
      <span className="text-xs font-medium uppercase tracking-wider text-ink-muted">
        {label}
      </span>
      {children}
    </label>
  );
}
