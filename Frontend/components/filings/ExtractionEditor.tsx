"use client";

import * as React from "react";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import {
  columnLabel,
  formatINR,
  isDateKey,
  isMoneyKey,
  sectionLabel,
} from "@/lib/filings/extractionLabels";
import {
  patchExtraction,
  reextractDocument,
  type DocumentDTO,
  type ExtractionPayload,
} from "@/lib/api/documents";

/**
 * Structured editor over a Vertex AI Gemini extraction payload.
 *
 * Layout decisions, in order of importance:
 *   - Arrays of homogeneous objects render as TABLES (one row per item,
 *     one column per field). This is the "Capital gains" / "Transactions"
 *     / "TDS quarterly" experience the user expects from a tax doc.
 *   - Top-level scalars (financial_year, broker_name, totals…) render as
 *     a small card of form fields at the top.
 *   - Nested objects (employer, employee, statement_period…) render as
 *     mini-cards of fields.
 *
 * Every cell is editable. Dirty state is tracked by dotted path
 * ("equity_stcg_111a[0].buy_price") and sent verbatim to
 * PATCH /documents/{id}/extraction as `user_overrides`. The original
 * `raw` block is never mutated server-side; the merged view (raw +
 * user_overrides) is what we render.
 */

type Leaf = string | number | boolean | null;

function isLeaf(v: unknown): v is Leaf {
  return v === null || ["string", "number", "boolean"].includes(typeof v);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isArrayOfObjects(v: unknown): v is Record<string, unknown>[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.every((it) => isPlainObject(it))
  );
}

function mergeOverrides(
  raw: Record<string, unknown>,
  overrides: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!overrides || Object.keys(overrides).length === 0) return raw;
  const merged = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
  for (const [path, value] of Object.entries(overrides)) {
    setByPath(merged, path, value);
  }
  return merged;
}

function setByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter((p) => p !== "");
  let cur: any = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (cur[part] == null || typeof cur[part] !== "object") {
      cur[part] = isNaN(Number(parts[i + 1])) ? {} : [];
    }
    cur = cur[part];
  }
  cur[parts[parts.length - 1]!] = value;
}

function coerce(prevType: string, raw: string): Leaf {
  if (raw === "") return null;
  if (prevType === "number") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : raw;
  }
  if (prevType === "boolean") {
    if (raw === "true") return true;
    if (raw === "false") return false;
    return raw;
  }
  return raw;
}

function valueType(v: unknown): "string" | "number" | "boolean" | "null" {
  if (v === null) return "null";
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "boolean";
  return "string";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ExtractionEditor({
  doc,
  onUpdated,
}: {
  doc: DocumentDTO;
  onUpdated: (updated: DocumentDTO) => void;
}) {
  const payload: ExtractionPayload | null = doc.extraction_payload ?? null;
  const merged = React.useMemo(
    () => (payload ? mergeOverrides(payload.raw, payload.user_overrides) : null),
    [payload],
  );
  const [edits, setEdits] = React.useState<Record<string, Leaf>>({});
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState<"save" | "reextract" | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setEdits({});
    setReason("");
    setError(null);
  }, [doc.id, doc.updated_at]);

  if (!payload || !merged) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No extraction yet</CardTitle>
          <CardDescription>
            Vertex AI Gemini hasn't extracted fields for this document yet.
            {doc.extraction_error && (
              <> Last error: <span className="text-signal-error">{doc.extraction_error}</span></>
            )}
          </CardDescription>
        </CardHeader>
        <CardBody>
          <Button
            type="button"
            variant="primary"
            size="md"
            loading={busy === "reextract"}
            onClick={async () => {
              setBusy("reextract");
              setError(null);
              try {
                const updated = await reextractDocument(doc.id);
                onUpdated(updated);
              } catch (e) {
                setError(e instanceof Error ? e.message : "Re-extract failed.");
              } finally {
                setBusy(null);
              }
            }}
          >
            Run extraction
          </Button>
          {error && <p className="mt-3 text-sm text-signal-error">{error}</p>}
        </CardBody>
      </Card>
    );
  }

  const handleEdit = (path: string, value: Leaf, originalValue: Leaf) => {
    setEdits((prev) => {
      const next = { ...prev };
      // Drop the override if the new value equals the raw value — keeps the
      // payload clean.
      if (value === originalValue) {
        delete next[path];
      } else {
        next[path] = value;
      }
      return next;
    });
  };

  const handleSave = async () => {
    setBusy("save");
    setError(null);
    try {
      const updated = await patchExtraction(doc.id, {
        fields: edits,
        reason: reason.trim() || undefined,
      });
      onUpdated(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save edits.");
    } finally {
      setBusy(null);
    }
  };

  const handleReextract = async () => {
    if (Object.keys(edits).length > 0) {
      const ok = confirm(
        "You have unsaved edits. Re-extracting will run Gemini fresh and drop these edits. Continue?",
      );
      if (!ok) return;
    }
    setBusy("reextract");
    setError(null);
    try {
      const updated = await reextractDocument(doc.id);
      onUpdated(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Re-extract failed.");
    } finally {
      setBusy(null);
    }
  };

  // Partition top-level keys by render strategy.
  const entries = Object.entries(merged);
  const scalarEntries = entries.filter(([, v]) => isLeaf(v));
  const tableEntries = entries.filter(([, v]) => isArrayOfObjects(v));
  const objectEntries = entries.filter(
    ([, v]) => isPlainObject(v) && !Array.isArray(v),
  );
  const otherArrayEntries = entries.filter(
    ([, v]) => Array.isArray(v) && !isArrayOfObjects(v),
  );

  const isDirty = Object.keys(edits).length > 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle>Extracted fields</CardTitle>
            <CardDescription>
              Pulled by Vertex AI Gemini · model{" "}
              <span className="font-mono">{payload.model_used}</span> · confidence{" "}
              {(payload.confidence * 100).toFixed(0)}%. Every field is editable;
              the original Gemini output is preserved.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Badge tone="info" size="sm">
              {sectionLabel(payload.doc_type)}
            </Badge>
            {payload.model_used === "stub" && (
              <Badge tone="warning" size="sm">
                Stub mode
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardBody className="flex flex-col gap-6">
        {/* ---- Top-level scalars (FY, broker, totals…) ---- */}
        {scalarEntries.length > 0 && (
          <Section title="Summary">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {scalarEntries.map(([k, v]) => (
                <ScalarField
                  key={k}
                  label={columnLabel(k)}
                  path={k}
                  value={(k in edits ? edits[k] : v) as Leaf}
                  originalValue={v as Leaf}
                  edited={k in edits}
                  overridden={k in (payload.user_overrides ?? {})}
                  fieldKey={k}
                  onEdit={handleEdit}
                />
              ))}
            </div>
          </Section>
        )}

        {/* ---- Nested objects (employer, period, statement_period…) ---- */}
        {objectEntries.map(([k, v]) => (
          <Section key={k} title={sectionLabel(k)}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Object.entries(v as Record<string, unknown>).map(([ik, iv]) => {
                if (!isLeaf(iv)) return null;
                const path = `${k}.${ik}`;
                return (
                  <ScalarField
                    key={path}
                    label={columnLabel(ik)}
                    path={path}
                    value={(path in edits ? edits[path] : iv) as Leaf}
                    originalValue={iv as Leaf}
                    edited={path in edits}
                    overridden={path in (payload.user_overrides ?? {})}
                    fieldKey={ik}
                    onEdit={handleEdit}
                  />
                );
              })}
            </div>
          </Section>
        ))}

        {/* ---- Array-of-objects sections rendered as TABLES ---- */}
        {tableEntries.map(([k, v]) => (
          <Section
            key={k}
            title={sectionLabel(k)}
            rightSlot={
              <span className="text-xs text-ink-muted">
                {(v as Record<string, unknown>[]).length} row
                {(v as Record<string, unknown>[]).length === 1 ? "" : "s"}
              </span>
            }
          >
            <TableSection
              sectionKey={k}
              rows={v as Record<string, unknown>[]}
              edits={edits}
              overrides={payload.user_overrides ?? {}}
              onEdit={handleEdit}
            />
          </Section>
        ))}

        {/* ---- Other arrays (heterogeneous / array-of-scalars) ---- */}
        {otherArrayEntries.map(([k, v]) => (
          <Section key={k} title={sectionLabel(k)}>
            <pre className="overflow-auto rounded-lg border border-line bg-surface-sunken p-3 text-xs">
              {JSON.stringify(v, null, 2)}
            </pre>
          </Section>
        ))}

        {isDirty && (
          <div className="flex flex-col gap-1.5 border-t border-line-subtle pt-4">
            <label className="text-xs font-medium uppercase tracking-wider text-ink-muted">
              Reason for these edits (optional, audit trail)
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              maxLength={500}
              className="rounded-md border border-line bg-surface-raised px-3 py-2 text-sm focus:border-navy focus:outline-none"
              placeholder="Why are you overriding the AI's extraction?"
            />
          </div>
        )}

        {error && <p className="text-sm text-signal-error">{error}</p>}

        <div className="flex flex-wrap items-center gap-2 border-t border-line-subtle pt-3">
          <Button
            type="button"
            variant="primary"
            size="md"
            disabled={!isDirty || busy !== null}
            loading={busy === "save"}
            onClick={handleSave}
          >
            Save edits ({Object.keys(edits).length})
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="md"
            disabled={busy !== null}
            loading={busy === "reextract"}
            onClick={handleReextract}
          >
            Re-extract with Gemini
          </Button>
          {isDirty && (
            <Button
              type="button"
              variant="ghost"
              size="md"
              disabled={busy !== null}
              onClick={() => {
                setEdits({});
                setReason("");
              }}
            >
              Discard
            </Button>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Section({
  title,
  children,
  rightSlot,
}: {
  title: string;
  children: React.ReactNode;
  rightSlot?: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {rightSlot}
      </header>
      {children}
    </section>
  );
}

function ScalarField({
  label,
  path,
  value,
  originalValue,
  edited,
  overridden,
  fieldKey,
  onEdit,
}: {
  label: string;
  path: string;
  value: Leaf;
  originalValue: Leaf;
  edited: boolean;
  overridden: boolean;
  fieldKey: string;
  onEdit: (path: string, value: Leaf, original: Leaf) => void;
}) {
  const inputType = isDateKey(fieldKey)
    ? "date"
    : isMoneyKey(fieldKey) || typeof originalValue === "number"
      ? "number"
      : "text";
  const step = inputType === "number" ? "0.01" : undefined;
  return (
    <label className="flex flex-col gap-1 rounded-lg border border-line bg-surface-sunken px-3 py-2">
      <span className="flex items-center justify-between gap-2 text-2xs font-medium uppercase tracking-wider text-ink-muted">
        <span className="truncate">{label}</span>
        {edited ? (
          <Badge tone="warning" size="sm">Edited</Badge>
        ) : overridden ? (
          <Badge tone="neutral" size="sm">Override</Badge>
        ) : null}
      </span>
      <input
        type={inputType}
        step={step}
        value={value === null ? "" : String(value)}
        placeholder={value === null ? "null" : undefined}
        onChange={(e) =>
          onEdit(path, coerce(valueType(originalValue), e.target.value), originalValue)
        }
        className="h-9 rounded-md border border-line bg-surface-raised px-2.5 text-sm focus:border-navy focus:outline-none"
      />
    </label>
  );
}

function TableSection({
  sectionKey,
  rows,
  edits,
  overrides,
  onEdit,
}: {
  sectionKey: string;
  rows: Record<string, unknown>[];
  edits: Record<string, Leaf>;
  overrides: Record<string, unknown>;
  onEdit: (path: string, value: Leaf, original: Leaf) => void;
}) {
  // Union of all keys across the rows, with a stable order: keys from row 0
  // first, then any extras appended in first-seen order.
  const columns = React.useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const row of rows) {
      for (const k of Object.keys(row)) {
        if (!seen.has(k)) {
          seen.add(k);
          out.push(k);
        }
      }
    }
    return out;
  }, [rows]);

  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full border-collapse text-left text-sm">
        <thead className="bg-surface-sunken text-2xs uppercase tracking-wider text-ink-muted">
          <tr>
            <th className="w-8 px-2 py-2 text-right">#</th>
            {columns.map((c) => (
              <th key={c} className="px-3 py-2 whitespace-nowrap">
                {columnLabel(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className="border-t border-line-subtle hover:bg-surface-sunken/40"
            >
              <td className="px-2 py-1.5 text-right tabular-nums text-2xs text-ink-muted">
                {i + 1}
              </td>
              {columns.map((c) => {
                const path = `${sectionKey}[${i}].${c}`;
                const raw = row[c];
                if (isLeaf(raw)) {
                  return (
                    <TableCell
                      key={c}
                      path={path}
                      value={(path in edits ? edits[path] : raw) as Leaf}
                      originalValue={raw as Leaf}
                      edited={path in edits}
                      overridden={path in overrides}
                      fieldKey={c}
                      onEdit={onEdit}
                    />
                  );
                }
                return (
                  <td key={c} className="px-3 py-1.5 align-top">
                    <pre className="m-0 max-w-xs overflow-auto text-2xs text-ink-muted">
                      {JSON.stringify(raw)}
                    </pre>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TableCell({
  path,
  value,
  originalValue,
  edited,
  overridden,
  fieldKey,
  onEdit,
}: {
  path: string;
  value: Leaf;
  originalValue: Leaf;
  edited: boolean;
  overridden: boolean;
  fieldKey: string;
  onEdit: (path: string, value: Leaf, original: Leaf) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const isDate = isDateKey(fieldKey);
  const isMoney = isMoneyKey(fieldKey) || typeof originalValue === "number";
  const inputType = isDate ? "date" : isMoney ? "number" : "text";
  const step = inputType === "number" ? "0.01" : undefined;

  // Click-to-edit display value
  const display: React.ReactNode = (() => {
    if (value == null || value === "") return <span className="text-ink-subtle">—</span>;
    if (isMoney) return <span className="tabular-nums">{formatINR(value)}</span>;
    return String(value);
  })();

  if (!editing) {
    return (
      <td
        className="cursor-text px-3 py-1.5 align-top text-ink"
        onClick={() => setEditing(true)}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setEditing(true);
          }
        }}
      >
        <span className="inline-flex items-center gap-1.5">
          {display}
          {edited && (
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-signal-warning" title="Edited" />
          )}
          {!edited && overridden && (
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-ink-subtle" title="Override" />
          )}
        </span>
      </td>
    );
  }

  return (
    <td className="px-2 py-1 align-top">
      <input
        autoFocus
        type={inputType}
        step={step}
        value={value === null ? "" : String(value)}
        onChange={(e) =>
          onEdit(path, coerce(valueType(originalValue), e.target.value), originalValue)
        }
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "Escape") {
            (e.target as HTMLInputElement).blur();
          }
        }}
        className="h-8 w-full min-w-[8rem] rounded-md border border-navy bg-surface-raised px-2 text-sm focus:outline-none"
      />
    </td>
  );
}
