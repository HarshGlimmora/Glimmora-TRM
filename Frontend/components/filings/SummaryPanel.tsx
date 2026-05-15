"use client";

import * as React from "react";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import type { SummaryDTO } from "@/lib/api/summary";

function inr(value: string | null | undefined): string {
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(n);
}

function humanizeHead(key: string): string {
  switch (key) {
    case "salary":
      return "Salary";
    case "interest":
      return "Interest income";
    case "dividend":
      return "Dividend";
    case "house_property":
      return "House property";
    case "pgbp":
      return "Business / profession";
    case "capital_gains":
      return "Capital gains";
    case "other_sources":
      return "Other sources";
    default:
      return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

function humanizeDeduction(key: string): string {
  if (key === "standard") return "Standard deduction (§16(ia))";
  return `§${key.toUpperCase()}`;
}

interface Row {
  label: string;
  value: string;
  emphasize?: boolean;
}

function LineItem({ label, value, emphasize }: Row) {
  return (
    <div
      className={
        "flex items-baseline justify-between gap-4 py-1.5" +
        (emphasize ? " border-t border-line-subtle pt-2.5" : "")
      }
    >
      <span
        className={
          "text-sm" +
          (emphasize ? " font-semibold text-ink" : " text-ink-muted")
        }
      >
        {label}
      </span>
      <span
        className={
          "tabular-nums" +
          (emphasize ? " text-base font-semibold text-ink" : " text-sm text-ink")
        }
      >
        {value}
      </span>
    </div>
  );
}

export function SummaryPanel({ summary }: { summary: SummaryDTO }) {
  const incomeEntries = Object.entries(summary.income_breakdown).sort(
    ([a], [b]) => a.localeCompare(b),
  );
  const dedEntries = Object.entries(summary.deductions).sort(([a], [b]) => {
    if (a === "standard") return -1;
    if (b === "standard") return 1;
    return a.localeCompare(b);
  });

  const tc = summary.tax_computation;

  const balanceNum = Number(summary.balance_payable);
  const balanceTone =
    !Number.isFinite(balanceNum) || balanceNum === 0
      ? "neutral"
      : balanceNum > 0
        ? "warning"
        : "success";

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardBody className="flex flex-col">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-display text-lg text-ink">Income breakdown</h3>
            <Badge tone="neutral" size="sm">
              From verified transactions
            </Badge>
          </div>
          {incomeEntries.length === 0 ? (
            <p className="text-sm text-ink-subtle">
              No verified income transactions for this filing.
            </p>
          ) : (
            <div className="flex flex-col">
              {incomeEntries.map(([k, v]) => (
                <LineItem key={k} label={humanizeHead(k)} value={inr(v)} />
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardBody className="flex flex-col">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-display text-lg text-ink">Deductions</h3>
            <Badge tone="neutral" size="sm">
              {summary.regime_used === "new" ? "New regime" : "Old regime"}
            </Badge>
          </div>
          {dedEntries.length === 0 ? (
            <p className="text-sm text-ink-subtle">No deductions applied.</p>
          ) : (
            <div className="flex flex-col">
              {dedEntries.map(([k, v]) => (
                <LineItem key={k} label={humanizeDeduction(k)} value={inr(v)} />
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      <Card className="lg:col-span-2">
        <CardBody className="flex flex-col">
          <h3 className="mb-3 font-display text-lg text-ink">Tax computation</h3>
          <div className="flex flex-col">
            <LineItem label="Taxable income" value={inr(tc.taxable_income)} />
            <LineItem label="Slab tax" value={inr(tc.slab_tax)} />
            <LineItem label="Less: §87A rebate" value={inr(tc.rebate_87a)} />
            <LineItem
              label="Flat-rate tax (§§111A / 112 / 112A / 115BB)"
              value={inr(tc.flat_rate_tax)}
            />
            <LineItem label="Surcharge" value={inr(tc.surcharge)} />
            <LineItem label="Health and Education Cess @ 4%" value={inr(tc.cess)} />
            <LineItem label="Total tax payable" value={inr(tc.total_tax)} emphasize />
          </div>
        </CardBody>
      </Card>

      <Card className="lg:col-span-2">
        <CardBody className="flex flex-col">
          <h3 className="mb-3 font-display text-lg text-ink">Balance</h3>
          <div className="flex flex-col">
            <LineItem label="Total tax" value={inr(tc.total_tax)} />
            <LineItem
              label="Less: TDS / prepaid taxes"
              value={inr(summary.tds_paid)}
            />
            <LineItem
              label={
                balanceTone === "success"
                  ? "Refund expected"
                  : "Balance payable"
              }
              value={inr(summary.balance_payable)}
              emphasize
            />
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
