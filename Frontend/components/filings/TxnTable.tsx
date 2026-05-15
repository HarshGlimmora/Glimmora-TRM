"use client";

import * as React from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils/cn";
import { TxnRow } from "@/components/filings/TxnRow";
import type {
  CategorizationMethod,
  TransactionDTO,
  TxnListQuery,
} from "@/lib/api/transactions";

type StatusFilter = "all" | "unverified" | "verified" | "rejected";

export interface TxnTableHandlers {
  onVerifySingle: (txn: TransactionDTO) => Promise<void> | void;
  onVerifyAll: (filter: { method?: CategorizationMethod }) => Promise<void> | void;
  onEdit: (txn: TransactionDTO) => void;
  onFiltersChange: (q: TxnListQuery) => void;
  busyTxnId?: string | null;
}

export function TxnTable({
  txns,
  total,
  filters,
  handlers,
}: {
  txns: TransactionDTO[];
  total: number;
  filters: TxnListQuery;
  handlers: TxnTableHandlers;
}) {
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  // Reset selection whenever the list reloads.
  React.useEffect(() => {
    setSelected(new Set());
  }, [txns]);

  const status: StatusFilter = (filters.status as StatusFilter | undefined) ?? "all";
  const method = filters.method;
  const head = filters.head ?? "";

  const setFilter = (patch: Partial<TxnListQuery>) => {
    handlers.onFiltersChange({ ...filters, ...patch, page: 1 });
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const visibleSelectable = txns.filter((t) => t.status !== "verified");
  const allSelected =
    visibleSelectable.length > 0 &&
    visibleSelectable.every((t) => selected.has(t.id));
  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(visibleSelectable.map((t) => t.id)));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <FilterChips
          label="Status"
          value={status}
          options={[
            { value: "all", label: "All" },
            { value: "unverified", label: "Unverified" },
            { value: "verified", label: "Verified" },
            { value: "rejected", label: "Rejected" },
          ]}
          onChange={(v) => setFilter({ status: v as StatusFilter })}
        />
        <FilterChips
          label="Method"
          value={method ?? "any"}
          options={[
            { value: "any", label: "Any" },
            { value: "rule", label: "RULE" },
            { value: "ai_assisted", label: "AI" },
            { value: "manual", label: "MANUAL" },
            { value: "unmatched", label: "Unmatched" },
          ]}
          onChange={(v) =>
            setFilter({ method: v === "any" ? undefined : (v as CategorizationMethod) })
          }
        />
        <input
          type="text"
          value={head}
          onChange={(e) => setFilter({ head: e.target.value || undefined })}
          placeholder="Filter by category…"
          className="h-9 w-48 rounded-md border border-line bg-surface-raised px-3 text-sm focus:border-navy focus:outline-none"
        />
        <span className="ml-auto text-xs text-ink-muted">
          {total} match{total === 1 ? "" : "es"}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface-sunken px-3 py-2">
        <span className="text-xs text-ink-muted">Bulk:</span>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => handlers.onVerifyAll({ method: "rule" })}
        >
          Verify all RULE rows
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => handlers.onVerifyAll({})}
        >
          Verify everything unverified
        </Button>
        {selected.size > 0 && (
          <span className="ml-auto text-xs text-ink-muted">
            {selected.size} row{selected.size === 1 ? "" : "s"} selected
          </span>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full border-collapse text-left">
          <thead className="bg-surface-sunken/60 text-2xs uppercase tracking-wider text-ink-muted">
            <tr>
              <th className="py-2 pl-3 pr-2 w-8">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="h-4 w-4 cursor-pointer rounded border-line accent-navy"
                  aria-label="Select all unverified on this page"
                />
              </th>
              <th className="py-2 pr-3">Date</th>
              <th className="py-2 pr-3">Description</th>
              <th className="py-2 pr-3">Category</th>
              <th className="py-2 pr-3">Source</th>
              <th className="py-2 pr-3 text-right">Amount</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2 pr-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {txns.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-sm text-ink-muted">
                  No transactions match these filters.
                </td>
              </tr>
            ) : (
              txns.map((t) => (
                <TxnRow
                  key={t.id}
                  txn={t}
                  selected={selected.has(t.id)}
                  onToggleSelect={() => toggle(t.id)}
                  onVerify={() => handlers.onVerifySingle(t)}
                  onEdit={() => handlers.onEdit(t)}
                  busy={handlers.busyTxnId === t.id}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FilterChips({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-xs uppercase tracking-wider text-ink-muted">{label}:</span>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
            value === opt.value
              ? "border-navy bg-navy text-white"
              : "border-line bg-surface-raised text-ink-muted hover:border-navy/40 hover:text-ink",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
