"use client";

import * as React from "react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import type { DocumentDTO, RoutingReportShape } from "@/lib/api/documents";

/**
 * Renders a single document's routing report. Powered by either the
 * embedded `document.routing_report` payload (preferred — written at
 * upload time) or a fresh `getRoutingReport(id)` fetch supplied by the
 * parent.
 */
export function RoutingReportPanel({
  doc,
  report,
}: {
  doc: DocumentDTO;
  report?: RoutingReportShape | null;
}) {
  const r = report ?? doc.routing_report ?? null;
  const routedByFy = r?.transactions_routed ?? {};
  const fys = Object.keys(routedByFy);
  const total = Object.values(routedByFy).reduce((a, b) => a + b, 0);
  const unresolved = r?.unresolved ?? [];
  const notes = r?.notes ?? [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Routing report</CardTitle>
          <span className="font-mono text-xs text-ink-muted">
            {doc.file_name}
          </span>
        </div>
      </CardHeader>
      <CardBody className="flex flex-col gap-4">
        {total > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-ink-muted">
              {total} transaction{total === 1 ? "" : "s"} routed across{" "}
              {fys.length} FY{fys.length === 1 ? "" : "s"}.
            </p>
            <ul className="flex flex-wrap gap-2">
              {fys.map((fy) => (
                <li key={fy}>
                  <Badge tone="seal" size="md">
                    {fy} · {routedByFy[fy]}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        ) : r?.extraction_pending ? (
          <p className="text-sm text-ink-muted">
            Extraction is pending. Once Step 3 wires the PDF pipeline this panel
            will show which FYs each line was routed to.
          </p>
        ) : (
          <p className="text-sm text-ink-muted">No rows were routed.</p>
        )}

        {unresolved.length > 0 && (
          <div className="rounded-lg border border-signal-warning/30 bg-signal-warning-soft px-3 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wider text-signal-warning">
              {unresolved.length} unresolved row{unresolved.length === 1 ? "" : "s"}
            </p>
            <ul className="mt-1 flex flex-col gap-0.5 text-xs">
              {unresolved.slice(0, 5).map((u, i) => (
                <li key={i} className="text-ink">
                  {u.reason}
                </li>
              ))}
              {unresolved.length > 5 && (
                <li className="text-ink-muted">
                  + {unresolved.length - 5} more
                </li>
              )}
            </ul>
          </div>
        )}

        {notes.length > 0 && (
          <ul className="flex flex-col gap-1 text-xs text-ink-muted">
            {notes.map((n, i) => (
              <li key={i}>• {n}</li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
