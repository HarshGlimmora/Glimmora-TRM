"use client";

import * as React from "react";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils/cn";
import type { Regime, RegimeResultDTO } from "@/lib/api/regime";

interface Props {
  oldRegime: RegimeResultDTO | null;
  newRegime: RegimeResultDTO | null;
  recommended: Regime | null;
  savings: string | null;
  committed: Regime | null;
  selected: Regime | null;
  onSelect: (regime: Regime) => void;
  disabled?: boolean;
}

// Money values arrive as strings (NUMERIC(18,2)). Render in Indian grouping.
function inr(s: string | null | undefined): string {
  if (s == null || s === "") return "—";
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

function RegimeCard({
  label,
  regime,
  result,
  isRecommended,
  isCommitted,
  isSelected,
  onSelect,
  disabled,
}: {
  label: string;
  regime: Regime;
  result: RegimeResultDTO | null;
  isRecommended: boolean;
  isCommitted: boolean;
  isSelected: boolean;
  onSelect: () => void;
  disabled?: boolean;
}) {
  return (
    <Card
      className={cn(
        "transition-colors",
        isSelected
          ? "border-navy ring-2 ring-navy/20"
          : isRecommended
            ? "border-accent/40"
            : undefined,
      )}
    >
      <CardBody className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-ink-muted">
              {label}
            </p>
            <h3 className="font-display text-xl text-ink">
              {regime === "new" ? "New regime" : "Old regime"}
            </h3>
          </div>
          <div className="flex flex-col items-end gap-1">
            {isCommitted && (
              <Badge tone="seal" size="sm" withDot>
                Current
              </Badge>
            )}
            {isRecommended && (
              <Badge tone="success" size="sm">
                Recommended
              </Badge>
            )}
          </div>
        </div>

        {result ? (
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-ink-muted">Taxable income</dt>
            <dd className="text-right tabular-nums text-ink">
              {inr(result.taxable_income)}
            </dd>
            <dt className="text-ink-muted">Tax before cess</dt>
            <dd className="text-right tabular-nums text-ink">
              {inr(
                String(
                  Number(result.slab_tax || "0") +
                    Number(result.flat_rate_tax || "0") +
                    Number(result.surcharge || "0") -
                    Number(result.rebate_87a || "0"),
                ),
              )}
            </dd>
            <dt className="text-ink-muted">Cess</dt>
            <dd className="text-right tabular-nums text-ink">
              {inr(result.cess)}
            </dd>
            <dt className="text-ink-muted">TDS paid</dt>
            <dd className="text-right tabular-nums text-ink">
              {inr(result.tds_paid)}
            </dd>
            <dt className="border-t border-line-subtle pt-2 text-sm font-medium text-ink">
              Total tax
            </dt>
            <dd className="border-t border-line-subtle pt-2 text-right tabular-nums text-base font-semibold text-ink">
              {inr(result.total_tax)}
            </dd>
            <dt className="text-ink-muted">Balance payable</dt>
            <dd className="text-right tabular-nums text-ink">
              {inr(result.balance_payable)}
            </dd>
          </dl>
        ) : (
          <p className="text-sm text-ink-subtle">No computation yet.</p>
        )}

        <Button
          variant={isSelected ? "primary" : "outline"}
          fullWidth
          onClick={onSelect}
          disabled={disabled || !result}
        >
          {isCommitted
            ? `Keep ${regime} regime`
            : isSelected
              ? `Choosing ${regime}…`
              : `Choose ${regime} regime`}
        </Button>
      </CardBody>
    </Card>
  );
}

export function RegimeCards({
  oldRegime,
  newRegime,
  recommended,
  savings,
  committed,
  selected,
  onSelect,
  disabled,
}: Props) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <RegimeCard
          label="Pre-FY 2023-24 default"
          regime="old"
          result={oldRegime}
          isRecommended={recommended === "old"}
          isCommitted={committed === "old"}
          isSelected={selected === "old"}
          onSelect={() => onSelect("old")}
          disabled={disabled}
        />
        <RegimeCard
          label="Default from FY 2023-24"
          regime="new"
          result={newRegime}
          isRecommended={recommended === "new"}
          isCommitted={committed === "new"}
          isSelected={selected === "new"}
          onSelect={() => onSelect("new")}
          disabled={disabled}
        />
      </div>
      {recommended && savings && Number(savings) > 0 && (
        <p className="text-sm text-ink-muted">
          By choosing the <strong className="text-ink">{recommended}</strong>{" "}
          regime, you save approximately{" "}
          <strong className="text-ink">{inr(savings)}</strong> compared to the
          other regime.
        </p>
      )}
    </div>
  );
}
