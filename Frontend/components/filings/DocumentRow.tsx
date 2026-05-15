"use client";

import * as React from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils/cn";
import {
  deleteDocument,
  downloadDocumentUrl,
  type DocumentDTO,
  type DocumentType,
  type RoutingStatus,
} from "@/lib/api/documents";

const DOC_TYPE_LABELS: Record<DocumentType, string> = {
  form16: "Form 16",
  form_26as: "Form 26AS",
  ais_tis: "AIS / TIS",
  salary_slip: "Salary slip",
  bank_csv: "Bank statement (CSV)",
  bank_pdf: "Bank statement (PDF)",
  unknown_pdf: "PDF — pending classification",
  capital_gains_statement: "Capital gains statement",
  broker_pnl: "Broker P&L statement",
};

const ROUTING_TONE: Record<
  RoutingStatus,
  { label: string; tone: "neutral" | "success" | "warning" | "info" | "error" }
> = {
  pending: { label: "Pending", tone: "info" },
  routed: { label: "Routed", tone: "success" },
  partially_routed: { label: "Partially routed", tone: "warning" },
  unresolved: { label: "Unresolved", tone: "error" },
  overridden: { label: "Overridden", tone: "neutral" },
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentRow({
  doc,
  onDeleted,
  onViewRouting,
  onReassign,
  onViewExtraction,
}: {
  doc: DocumentDTO;
  onDeleted: (id: string) => void;
  onViewRouting?: (doc: DocumentDTO) => void;
  onReassign?: (doc: DocumentDTO) => void;
  onViewExtraction?: (doc: DocumentDTO) => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const routing = ROUTING_TONE[doc.routing_status];
  const extractionPending = doc.routing_report?.extraction_pending === true;

  const handleDelete = async () => {
    if (busy) return;
    if (!confirm(`Delete ${doc.file_name}? Linked transactions are removed too.`))
      return;
    setBusy(true);
    try {
      await deleteDocument(doc.id);
      onDeleted(doc.id);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not delete document.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-line bg-surface-raised px-4 py-3.5",
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium text-ink">
            {doc.file_name}
          </span>
          <Badge tone="neutral" size="sm">
            {DOC_TYPE_LABELS[doc.document_type] ?? doc.document_type}
          </Badge>
          <Badge tone={routing.tone} size="sm" withDot>
            {routing.label}
          </Badge>
          {extractionPending && (
            <Badge tone="info" size="sm">
              Extracting · Step 3
            </Badge>
          )}
        </div>
        <p className="text-xs text-ink-muted">
          {formatBytes(doc.size_bytes)}
          {doc.tax_year ? ` · ${doc.tax_year}` : ""}
          {" · "}
          <span className="font-mono">{doc.sha256.slice(0, 12)}…</span>
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 border-t border-line-subtle pt-2.5">
        {onViewRouting && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onViewRouting(doc)}
          >
            Routing
          </Button>
        )}
        {onViewExtraction && (doc.mime_type === "application/pdf" || doc.extraction_payload) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onViewExtraction(doc)}
          >
            Extraction
          </Button>
        )}
        {onReassign && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onReassign(doc)}
          >
            Reassign FY
          </Button>
        )}
        <a
          href={downloadDocumentUrl(doc.id)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-9 items-center justify-center rounded-md px-3 text-sm text-ink hover:bg-surface-sunken"
        >
          Open
        </a>
        <span className="ml-auto" />
        <Button
          type="button"
          variant="danger"
          size="sm"
          onClick={handleDelete}
          disabled={busy}
        >
          {busy ? "Deleting…" : "Delete"}
        </Button>
      </div>
    </li>
  );
}
