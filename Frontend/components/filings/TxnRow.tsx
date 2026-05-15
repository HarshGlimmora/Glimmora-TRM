"use client";

import * as React from "react";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils/cn";
import type {
  CategorizationMethod,
  TransactionDTO,
  TxnStatus,
} from "@/lib/api/transactions";

const METHOD_TONE: Record<
  CategorizationMethod,
  { label: string; tone: "info" | "warning" | "success" | "neutral" }
> = {
  rule: { label: "RULE", tone: "success" },
  ai_assisted: { label: "AI", tone: "info" },
  manual: { label: "MANUAL", tone: "warning" },
  unmatched: { label: "?", tone: "neutral" },
};

const STATUS_TONE: Record<
  TxnStatus,
  { label: string; tone: "success" | "neutral" | "error" }
> = {
  verified: { label: "Verified", tone: "success" },
  unverified: { label: "Unverified", tone: "neutral" },
  rejected: { label: "Rejected", tone: "error" },
};

export function formatAmount(amountStr: string): string {
  const n = Number(amountStr);
  if (Number.isNaN(n)) return amountStr;
  const sign = n < 0 ? "−" : "";
  // Indian grouping: 1,23,456.78
  const abs = Math.abs(n).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}₹${abs}`;
}

export function TxnRow({
  txn,
  selected,
  onToggleSelect,
  onVerify,
  onEdit,
  busy,
}: {
  txn: TransactionDTO;
  selected: boolean;
  onToggleSelect: () => void;
  onVerify: () => void;
  onEdit: () => void;
  busy?: boolean;
}) {
  const method = METHOD_TONE[txn.categorization_method] ?? METHOD_TONE.unmatched;
  const stat = STATUS_TONE[txn.status];
  const isCredit = Number(txn.amount) > 0;

  return (
    <tr
      className={cn(
        "border-b border-line-subtle hover:bg-surface-sunken/40 transition-colors",
        selected && "bg-navy-tint/30",
      )}
    >
      <td className="py-2.5 pl-3 pr-2 align-top">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          className="h-4 w-4 cursor-pointer rounded border-line accent-navy"
          disabled={txn.status === "verified"}
          aria-label={`Select ${txn.description ?? "transaction"}`}
        />
      </td>
      <td className="py-2.5 pr-3 align-top whitespace-nowrap font-mono text-xs text-ink-muted">
        {txn.txn_date}
      </td>
      <td className="py-2.5 pr-3 align-top">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm text-ink truncate max-w-[42ch]">
            {txn.description ?? "—"}
          </span>
          {txn.counterparty && (
            <span className="text-2xs text-ink-muted">{txn.counterparty}</span>
          )}
        </div>
      </td>
      <td className="py-2.5 pr-3 align-top">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm text-ink">{txn.category ?? "—"}</span>
          {txn.rule_matched && (
            <span className="font-mono text-2xs text-ink-muted">
              rule:{txn.rule_matched}
            </span>
          )}
        </div>
      </td>
      <td className="py-2.5 pr-3 align-top">
        <Badge tone={method.tone} size="sm">
          {method.label}
        </Badge>
      </td>
      <td
        className={cn(
          "py-2.5 pr-3 align-top text-right whitespace-nowrap tabular-nums text-sm",
          isCredit ? "text-signal-success" : "text-ink",
        )}
      >
        {formatAmount(txn.amount)}
      </td>
      <td className="py-2.5 pr-3 align-top whitespace-nowrap">
        <Badge tone={stat.tone} size="sm" withDot>
          {stat.label}
        </Badge>
      </td>
      <td className="py-2.5 pr-3 align-top whitespace-nowrap text-right">
        <button
          type="button"
          onClick={onEdit}
          disabled={busy}
          className="rounded-md px-2 py-1 text-xs text-ink-muted hover:bg-surface-sunken hover:text-ink disabled:opacity-50"
        >
          Edit
        </button>
        {txn.status !== "verified" && (
          <button
            type="button"
            onClick={onVerify}
            disabled={busy}
            className="ml-1 rounded-md bg-navy px-2 py-1 text-xs font-medium text-white hover:bg-navy-deep disabled:opacity-50"
          >
            Verify
          </button>
        )}
      </td>
    </tr>
  );
}
