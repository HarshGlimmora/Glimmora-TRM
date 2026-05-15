"use client";

import * as React from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { reassignDocument, type DocumentDTO } from "@/lib/api/documents";
import { listYears } from "@/lib/api/filings";

/**
 * Reassign a document (and all its transactions) to a different financial year.
 *
 * The FY router auto-routes each row by date at upload; this dialog is for the
 * override path — a row whose date is technically correct for one FY but which
 * the user wants tracked under a different filing (e.g. cross-year arrears
 * paid in April but earned in March). The server flips routing_method to
 * 'manual_override' on every affected transaction.
 */
const FY_PATTERN = /^FY\d{4}-\d{2}$/;

export function ReassignFyDialog({
  open,
  doc,
  onClose,
  onReassigned,
}: {
  open: boolean;
  doc: DocumentDTO | null;
  onClose: () => void;
  onReassigned: (updated: DocumentDTO) => void;
}) {
  const [knownFys, setKnownFys] = React.useState<string[]>([]);
  const [target, setTarget] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setError(null);
    setReason("");
    setTarget(doc?.tax_year ?? "");
    void (async () => {
      try {
        const list = await listYears();
        // Surface the user's existing FYs first, but always offer the
        // current and previous FYs as sane defaults.
        const fromList = list.items.map((it) => it.tax_year);
        const merged = Array.from(
          new Set([...fromList, "FY2025-26", "FY2024-25", "FY2023-24"]),
        ).sort((a, b) => (a < b ? 1 : -1));
        setKnownFys(merged);
      } catch {
        setKnownFys(["FY2025-26", "FY2024-25", "FY2023-24"]);
      }
    })();
  }, [open, doc]);

  if (!doc) return null;

  const handleSubmit = async () => {
    setError(null);
    if (!FY_PATTERN.test(target)) {
      setError("FY must match the format FYYYYY-YY (e.g. FY2024-25).");
      return;
    }
    if (target === doc.tax_year) {
      setError("That's already the document's FY — nothing to change.");
      return;
    }
    setBusy(true);
    try {
      const updated = await reassignDocument(doc.id, {
        tax_year: target,
        reason: reason.trim() || undefined,
      });
      onReassigned(updated);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reassign document.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title="Reassign financial year"
      description={`Move ${doc.file_name} and every transaction it produced to a different FY. The FY router won't second-guess your choice; this is a manual override.`}
      size="md"
      footer={
        <>
          <Button
            type="button"
            variant="ghost"
            size="md"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={handleSubmit}
            loading={busy}
            disabled={busy}
          >
            Reassign
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium uppercase tracking-wider text-ink-muted">
            Target financial year
          </label>
          <div className="flex flex-wrap gap-1.5">
            {knownFys.map((fy) => (
              <button
                key={fy}
                type="button"
                onClick={() => setTarget(fy)}
                className={
                  "rounded-full border px-3 py-1 text-xs transition-colors " +
                  (target === fy
                    ? "border-navy bg-navy text-white"
                    : "border-line bg-surface-raised text-ink-muted hover:border-navy/40 hover:text-ink")
                }
              >
                {fy}
              </button>
            ))}
          </div>
          <input
            type="text"
            value={target}
            onChange={(e) => setTarget(e.target.value.toUpperCase().trim())}
            placeholder="FY2024-25"
            className="mt-1 h-10 rounded-md border border-line bg-surface-raised px-3 font-mono text-sm focus:border-navy focus:outline-none"
          />
          <p className="text-xs text-ink-muted">
            Currently: <span className="font-mono">{doc.tax_year ?? "—"}</span>
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium uppercase tracking-wider text-ink-muted">
            Reason <span className="text-ink-subtle">(optional, recorded in audit log)</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Why are you overriding the auto-routed FY?"
            className="rounded-md border border-line bg-surface-raised px-3 py-2 text-sm focus:border-navy focus:outline-none"
          />
        </div>

        {error && <p className="text-sm text-signal-error">{error}</p>}
      </div>
    </Modal>
  );
}
