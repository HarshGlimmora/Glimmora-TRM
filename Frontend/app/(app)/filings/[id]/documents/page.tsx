"use client";

import * as React from "react";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { UploadDropzone } from "@/components/filings/UploadDropzone";
import { DocumentRow } from "@/components/filings/DocumentRow";
import { RoutingReportPanel } from "@/components/filings/RoutingReportPanel";
import { ReassignFyDialog } from "@/components/filings/ReassignFyDialog";
import { ExtractionEditor } from "@/components/filings/ExtractionEditor";
import { useFiling } from "@/lib/filings/context";
import { listFilingDocuments, type DocumentDTO } from "@/lib/api/documents";

export default function FilingDocumentsPage() {
  const { filing } = useFiling();
  const [docs, setDocs] = React.useState<DocumentDTO[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [focusDoc, setFocusDoc] = React.useState<DocumentDTO | null>(null);
  const [reassignDoc, setReassignDoc] = React.useState<DocumentDTO | null>(null);
  const [extractionDoc, setExtractionDoc] = React.useState<DocumentDTO | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      const list = await listFilingDocuments(filing.id);
      setDocs(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load documents.");
    }
  }, [filing.id]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleUploaded = React.useCallback(
    (doc: DocumentDTO) => {
      // Show the freshly uploaded document immediately, then refresh to pick
      // up its filing_id assignment + routing report (which the server fills
      // in synchronously today).
      setDocs((prev) => (prev ? [doc, ...prev.filter((d) => d.id !== doc.id)] : [doc]));
      setFocusDoc(doc);
      void refresh();
    },
    [refresh],
  );

  const handleDeleted = (id: string) => {
    setDocs((prev) => (prev ? prev.filter((d) => d.id !== id) : prev));
    if (focusDoc?.id === id) setFocusDoc(null);
    if (extractionDoc?.id === id) setExtractionDoc(null);
  };

  const handleExtractionUpdated = (updated: DocumentDTO) => {
    setDocs((prev) =>
      prev ? prev.map((d) => (d.id === updated.id ? updated : d)) : prev,
    );
    setExtractionDoc(updated);
    if (focusDoc?.id === updated.id) setFocusDoc(updated);
  };

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle>Upload documents</CardTitle>
          <CardDescription>
            Drop Form 16, Form 26AS, AIS / TIS, salary slips, and bank
            statements. We detect the type and route each row to the correct
            financial year. CSV rows are categorised by deterministic rules;
            PDF extraction (Vertex AI Gemini) is wired in Step 3.
          </CardDescription>
        </CardHeader>
        <CardBody>
          <UploadDropzone onUploaded={handleUploaded} />
        </CardBody>
      </Card>

      {focusDoc && <RoutingReportPanel doc={focusDoc} />}

      {extractionDoc && (
        <ExtractionEditor
          doc={extractionDoc}
          onUpdated={handleExtractionUpdated}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Uploaded documents</CardTitle>
          <CardDescription>
            Documents attached to this filing ({filing.tax_year}). Rows that
            belong to other FYs are routed to sibling drafts and shown in
            those workspaces.
          </CardDescription>
        </CardHeader>
        <CardBody>
          {error && (
            <p className="mb-3 text-sm text-signal-error">{error}</p>
          )}
          {!docs ? (
            <div className="grid place-items-center py-6">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-navy/20 border-t-navy" />
            </div>
          ) : docs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line bg-surface-sunken px-6 py-10 text-center">
              <p className="text-sm font-medium text-ink">No documents yet</p>
              <p className="mt-1 text-xs text-ink-muted">
                Use the dropzone above to add your first document.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {docs.map((d) => (
                <DocumentRow
                  key={d.id}
                  doc={d}
                  onDeleted={handleDeleted}
                  onViewRouting={() => setFocusDoc(d)}
                  onReassign={() => setReassignDoc(d)}
                  onViewExtraction={() => setExtractionDoc(d)}
                />
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <ReassignFyDialog
        open={reassignDoc !== null}
        doc={reassignDoc}
        onClose={() => setReassignDoc(null)}
        onReassigned={(updated) => {
          setDocs((prev) =>
            prev ? prev.map((d) => (d.id === updated.id ? updated : d)) : prev,
          );
          if (focusDoc?.id === updated.id) setFocusDoc(updated);
        }}
      />
    </div>
  );
}
