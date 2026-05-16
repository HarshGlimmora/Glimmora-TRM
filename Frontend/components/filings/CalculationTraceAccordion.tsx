"use client";

import * as React from "react";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import type {
  CalculationTraceDTO,
  ExplainStepDTO,
  TraceStepDTO,
} from "@/lib/api/summary";
import { cn } from "@/lib/utils/cn";

function inr(value: string | undefined | null): string {
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

// User-facing names for the engine's `op` codes. Anything not in the map
// falls back to title-cased snake_case (apply_surcharge → Apply Surcharge).
const OP_LABELS: Record<string, string> = {
  context: "Filing context",
  sum_head_salary: "Salary income",
  sum_head_pgbp: "Business / profession income",
  sum_head_other_sources_slab: "Other sources income",
  sum_head_capital_gains: "Capital gains",
  apply_standard_deduction: "Standard deduction",
  apply_chapter_via: "Chapter VI-A deductions",
  aggregate_gti: "Gross total income",
  taxable_income: "Taxable income",
  apply_slab: "Slab tax",
  apply_87a: "§87A rebate",
  apply_87a_rebate: "§87A rebate",
  apply_flat_rate: "Flat-rate tax",
  apply_surcharge: "Surcharge",
  apply_cess: "Health & Education Cess",
  total: "Total tax payable",
  balance: "Balance / refund",
};

function humanizeOp(op: string): string {
  if (OP_LABELS[op]) return OP_LABELS[op];
  return op
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Section refs come in two flavours:
//   - Section-style codes  ("15-17", "87A", "115BAC", "16(ia)") → prefix with §
//   - Statute-style labels ("Schedule I", "Finance Act 2018")   → render verbatim
// We don't want "§Finance Act 2018" — that reads wrong.
function formatSectionRef(ref: string | undefined): string | null {
  if (!ref) return null;
  // Starts with a digit → section code.
  if (/^[0-9]/.test(ref)) return `§${ref}`;
  return ref;
}

interface RowProps {
  step: TraceStepDTO;
  explanation: ExplainStepDTO | undefined;
  loading: boolean;
  open: boolean;
  onToggle: () => void;
}

function StepRow({ step, explanation, loading, open, onToggle }: RowProps) {
  const heading = humanizeOp(step.op);
  const sectionLabel = formatSectionRef(step.section_ref);
  return (
    <li className="border-b border-line-subtle last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-sunken/40"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-xs font-semibold text-ink-muted">
          {step.step}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-ink">{heading}</span>
            {sectionLabel && (
              <Badge tone="navy" size="sm">
                {sectionLabel}
              </Badge>
            )}
          </div>
          {/* The expanded body already shows the full paragraph — no need to
             repeat it as a clamped preview here. Showing the section ref
             and the result gives a one-glance summary when collapsed. */}
        </div>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">
          {inr(step.result)}
        </span>
        <span
          aria-hidden
          className={cn(
            "ml-1 inline-block transition-transform",
            open && "rotate-90",
          )}
        >
          ›
        </span>
      </button>
      {open && (
        <div className="border-t border-line-subtle bg-surface-sunken/30 px-4 py-3 text-sm text-ink">
          {loading && !explanation ? (
            <p className="text-ink-muted">Generating explanation…</p>
          ) : (
            <p className="text-pretty leading-relaxed">
              {explanation?.plain_text ?? step.human_explanation}
            </p>
          )}

          {explanation && explanation.fields.length > 0 && (
            <dl className="mt-3 divide-y divide-line-subtle rounded-lg border border-line bg-surface-raised">
              {explanation.fields.map((f, i) => (
                <div
                  key={`${f.label}-${i}`}
                  className="flex items-baseline justify-between gap-4 px-3 py-2"
                >
                  <dt className="text-sm text-ink-muted">{f.label}</dt>
                  <dd className="text-sm tabular-nums text-ink">{f.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </li>
  );
}

export function CalculationTraceAccordion({
  trace,
  explanations,
  loading,
}: {
  trace: CalculationTraceDTO;
  explanations: ExplainStepDTO[];
  loading: boolean;
}) {
  const [open, setOpen] = React.useState<Set<number>>(new Set());
  const [allOpen, setAllOpen] = React.useState(false);

  const steps = trace.steps ?? [];
  const byStep = React.useMemo(() => {
    const m = new Map<number, ExplainStepDTO>();
    for (const e of explanations) m.set(e.step, e);
    return m;
  }, [explanations]);

  const toggle = (n: number) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  };

  const expandAll = () => {
    if (allOpen) {
      setOpen(new Set());
      setAllOpen(false);
    } else {
      setOpen(new Set(steps.map((s) => s.step)));
      setAllOpen(true);
    }
  };

  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-lg text-ink">Calculation trace</h3>
            <p className="text-sm text-ink-muted">
              Every step the engine took, explained in plain English. Click a
              row to see what went in and how the result was reached.
            </p>
          </div>
          {steps.length > 0 && (
            <button
              type="button"
              onClick={expandAll}
              className="shrink-0 text-sm text-navy underline-offset-2 hover:underline"
            >
              {allOpen ? "Collapse all" : "Expand all"}
            </button>
          )}
        </div>
        {steps.length === 0 ? (
          <p className="text-sm text-ink-subtle">No trace recorded yet.</p>
        ) : (
          <ul className="overflow-hidden rounded-lg border border-line bg-surface-raised">
            {steps.map((s) => (
              <StepRow
                key={s.step}
                step={s}
                explanation={byStep.get(s.step)}
                loading={loading}
                open={open.has(s.step)}
                onToggle={() => toggle(s.step)}
              />
            ))}
          </ul>
        )}
        {/*
          Rule versions are an internal audit artifact — useful for officer
          review and replay verification, surfaced to taxpayers only confuses
          them. Hidden from the taxpayer accordion. Officers see the same
          payload via /calculation-trace.
        */}
      </CardBody>
    </Card>
  );
}
