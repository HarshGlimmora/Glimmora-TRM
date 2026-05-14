"""End-to-end tax computation orchestrator.

Entry point: `compute_tax(db, filing_id, regime, ...)`.

Pipeline (per ARCHITECTURE.md §5.1 + TAXATION_CALCULATION.md §12):

  1. Aggregate income per head (salary, house property, PGBP, capital gains, other sources)
  2. Standard deduction on salary head
  3. Chapter VI-A deductions (old regime only)
  4. Slab tax on normal income
  5. §87A rebate (resident only; not on flat-rate tax; with marginal relief)
  6. Flat-rate taxes (§111A, §112, §112A, §115BB)
  7. Surcharge (with exact marginal relief; 15% cap on special-rate income)
  8. Health & Education Cess @ 4%
  9. Total tax → balance after TDS / prepaid
 10. Persist trace with pinned rule_versions
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.documents import Transaction
from app.models.filing import CalculationTrace, TaxReturn
from app.models.identity import User
from app.services.taxation.heads.capital_gains import compute_head_capital_gains
from app.services.taxation.heads.house_property import compute_head_house_property
from app.services.taxation.heads.other_sources import compute_head_other_sources
from app.services.taxation.money import Money, ZERO, money, quantize
from app.services.taxation.ops.cess import apply_cess
from app.services.taxation.ops.deductions import apply_chapter_via, apply_standard_deduction
from app.services.taxation.ops.flat_rate import apply_flat_rate
from app.services.taxation.ops.rebate import apply_87a
from app.services.taxation.ops.slab import apply_slab
from app.services.taxation.ops.surcharge import apply_surcharge
from app.services.taxation.result import FlatRateBucket, HeadResult, ResidencyStatus, SeniorStatus
from app.services.taxation.rules import RuleResolver
from app.services.taxation.statute import resolve_statute
from app.services.taxation.trace import TraceBuilder

Regime = Literal["old", "new"]


@dataclass
class TaxResult:
    regime: Regime
    fy: str
    statute: str
    gross_total_income: Money
    deductions: Money
    taxable_income: Money
    slab_tax: Money
    rebate_87a: Money
    flat_rate_tax: Money
    surcharge: Money
    cess: Money
    total_tax: Money
    tds_paid: Money
    balance_payable: Money
    trace: dict
    trace_id: str | None


def classify_age(dob: str | None, fy: str) -> SeniorStatus:
    """Classify age bracket on the LAST day of the FY (31-Mar of FY end year).

    `dob` is ISO format `YYYY-MM-DD`. Returns "<60", "60-79", or "80+".
    Defaults to "<60" if dob is missing.
    """
    if not dob:
        return "<60"
    try:
        d = date.fromisoformat(dob[:10])
    except (ValueError, TypeError):
        return "<60"
    # FY format "FYYYYY-YY" — extract end year (4-digit).
    end_year = int(fy[2:6]) + 1
    end_date = date(end_year, 3, 31)
    age = end_date.year - d.year - (
        (end_date.month, end_date.day) < (d.month, d.day)
    )
    if age >= 80:
        return "80+"
    if age >= 60:
        return "60-79"
    return "<60"


def _senior_slab_key(regime: Regime, senior: SeniorStatus) -> str:
    if regime != "old" or senior == "<60":
        return f"income_slab_{regime}_regime"
    if senior == "60-79":
        return "income_slab_old_regime_senior"
    return "income_slab_old_regime_super_senior"


def _resolve_residency(user: User | None, override: ResidencyStatus | None) -> ResidencyStatus:
    if override is not None:
        return override
    if user is not None:
        attr = getattr(user, "residency_status", None)
        if attr in ("resident", "non_resident", "rn_or"):
            return attr  # type: ignore[return-value]
    return "resident"


def _resolve_senior(user: User | None, override: SeniorStatus | None, fy: str) -> SeniorStatus:
    if override is not None:
        return override
    if user is not None:
        dob = getattr(user, "date_of_birth", None)
        if dob:
            return classify_age(dob, fy)
    return "<60"


def compute_tax(
    db: Session,
    *,
    filing_id: str,
    regime: Regime,
    residency_override: ResidencyStatus | None = None,
    senior_override: SeniorStatus | None = None,
    persist: bool = True,
) -> TaxResult:
    filing = db.get(TaxReturn, filing_id)
    if filing is None:
        raise LookupError(f"filing {filing_id} not found")

    user = db.get(User, filing.user_id)
    if user is None:
        raise LookupError(f"user {filing.user_id} (owner of filing) not found")

    fy = filing.tax_year
    statute = resolve_statute(fy)
    residency = _resolve_residency(user, residency_override)
    senior = _resolve_senior(user, senior_override, fy)

    resolver = RuleResolver(db, country=filing.country, tax_year=fy)
    trace = TraceBuilder(
        filing_id=filing_id, regime=regime, statute=statute, fy=fy, rule_versions={},
    )

    trace.step(
        op="context",
        section_ref="14",
        input={
            "fy": fy, "statute": statute, "regime": regime,
            "residency": residency, "senior_status": senior,
        },
        result=ZERO,
        human_explanation=(
            f"Computing tax for filing {filing_id} under {statute} ({fy}, "
            f"{regime} regime). Taxpayer residency: {residency}; age bracket: {senior}."
        ),
    )

    # ── 1. Load verified transactions, segregate by head ─────────────────────
    txns = (
        db.execute(
            select(Transaction)
            .where(Transaction.filing_id == filing_id)
            .where(Transaction.status == "verified")
        )
        .scalars()
        .all()
    )
    by_head: dict[str, list[Transaction]] = {}
    salary_breakdown: list[dict] = []
    pgbp_total = ZERO

    from app.services.taxation.defaults import head_of
    salary_income = ZERO
    for tx in txns:
        amt = money(tx.amount)
        head = head_of(tx.category)
        by_head.setdefault(head, []).append(tx)
        if head == "salary":
            salary_income = quantize(salary_income + amt)
            salary_breakdown.append({
                "label": tx.category or "salary", "amount": str(amt), "txn_id": tx.id,
            })
        elif head == "pgbp":
            pgbp_total = quantize(pgbp_total + amt)

    if salary_income > ZERO:
        trace.step(
            op="sum_head_salary",
            section_ref="15-17",
            input={"transactions": [b["txn_id"] for b in salary_breakdown]},
            breakdown=salary_breakdown,
            result=salary_income,
            human_explanation=(
                f"Salary income aggregated from {len(salary_breakdown)} verified "
                f"transaction(s): ₹{salary_income}. Source: Income Tax Act, 1961, "
                f"Sections 15–17."
            ),
        )

    # ── 2. Head pipelines (capital gains, other sources, house property) ─────
    cg_result: HeadResult = compute_head_capital_gains(
        by_head.get("capital_gains", []), resolver=resolver, trace=trace,
    )
    os_result: HeadResult = compute_head_other_sources(
        by_head.get("other_sources", []), resolver=resolver, trace=trace,
    )

    declared_hp = _declared_field(filing, "house_property")
    hp_result: HeadResult = compute_head_house_property(
        declared_hp, regime=regime, trace=trace,
    )

    if pgbp_total > ZERO:
        trace.step(
            op="sum_head_pgbp",
            section_ref="28-44DB",
            input={"head_total": str(pgbp_total)},
            result=pgbp_total,
            human_explanation=(
                f"Profits and Gains from Business or Profession: ₹{pgbp_total}. "
                f"Source: Sections 28–44DB."
            ),
        )

    # ── 3. Standard deduction on salary ──────────────────────────────────────
    std_ded = apply_standard_deduction(
        salary_income=salary_income, regime=regime, resolver=resolver, trace=trace,
    )
    salary_after_std = quantize(salary_income - std_ded)

    gti_normal = quantize(
        salary_after_std
        + hp_result.slab_taxable
        + pgbp_total
        + cg_result.slab_taxable
        + os_result.slab_taxable
    )
    trace.step(
        op="aggregate_gti",
        section_ref="14",
        input={
            "salary_after_std_deduction": str(salary_after_std),
            "house_property":             str(hp_result.slab_taxable),
            "pgbp":                       str(pgbp_total),
            "capital_gains_slab":         str(cg_result.slab_taxable),
            "other_sources_slab":         str(os_result.slab_taxable),
        },
        result=gti_normal,
        human_explanation=(
            f"Gross Total Income (slab portion) = ₹{gti_normal}. Source: §14. "
            f"This excludes capital gains and lottery routed to flat-rate sections."
        ),
    )

    # ── 4. Chapter VI-A deductions ───────────────────────────────────────────
    declared_via: dict = _declared_field(filing, "declared_deductions") or {}
    chapter_via = apply_chapter_via(
        gti=gti_normal, regime=regime, declared=declared_via,
        resolver=resolver, trace=trace,
    )

    taxable = quantize(gti_normal - chapter_via)
    if taxable < ZERO:
        taxable = ZERO
    trace.step(
        op="taxable_income",
        section_ref="2(45)",
        input={"gti_normal": str(gti_normal), "chapter_via": str(chapter_via)},
        result=taxable,
        human_explanation=(
            f"Total (Taxable) Income on slab portion = GTI ₹{gti_normal} − "
            f"Chapter VI-A ₹{chapter_via} = ₹{taxable}."
        ),
    )

    # ── 5. Slab tax ──────────────────────────────────────────────────────────
    slab_rule = resolver.get(_senior_slab_key(regime, senior))
    slab_tax = apply_slab(taxable, slab_rule, trace)

    # ── 6. §87A rebate ───────────────────────────────────────────────────────
    flat_total_income = quantize(cg_result.flat_total_income + os_result.flat_total_income)
    rebate_rule = resolver.get(f"rebate_87a_{regime}_regime")
    rebate = apply_87a(
        taxable_normal=taxable,
        slab_tax=slab_tax,
        total_income_including_flat=quantize(taxable + flat_total_income),
        is_resident=(residency == "resident"),
        rule=rebate_rule,
        trace=trace,
    )
    slab_tax_after_rebate = quantize(slab_tax - rebate)

    # ── 7. Flat-rate taxes (§§111A / 112 / 112A / 115BB) ─────────────────────
    all_buckets: list[FlatRateBucket] = [
        *cg_result.flat_rate_buckets, *os_result.flat_rate_buckets
    ]
    flat_taxes: list[Money] = [
        apply_flat_rate(b, resolver=resolver, trace=trace) for b in all_buckets
    ]
    flat_rate_tax_total = quantize(sum(flat_taxes, ZERO))

    # ── 8. Surcharge (exact marginal relief; 15% cap on flat-rate buckets) ──
    surcharge_rule = resolver.get(f"surcharge_{regime}_regime")
    total_income_for_surcharge = quantize(taxable + flat_total_income)
    surcharge = apply_surcharge(
        total_income=total_income_for_surcharge,
        slab_tax_after_rebate=slab_tax_after_rebate,
        flat_rate_buckets=all_buckets,
        flat_rate_taxes=flat_taxes,
        slab_rule_for_threshold=slab_rule,
        surcharge_rule=surcharge_rule,
        trace=trace,
    )

    # ── 9. Cess ──────────────────────────────────────────────────────────────
    cess_rule = resolver.get("cess")
    tax_plus_surcharge = quantize(slab_tax_after_rebate + flat_rate_tax_total + surcharge)
    cess = apply_cess(
        tax_plus_surcharge=tax_plus_surcharge, rule=cess_rule, trace=trace,
    )

    total_tax = quantize(tax_plus_surcharge + cess)
    trace.step(
        op="total",
        input={
            "slab_after_rebate": str(slab_tax_after_rebate),
            "flat_rate_tax":     str(flat_rate_tax_total),
            "surcharge":         str(surcharge),
            "cess":              str(cess),
        },
        result=total_tax,
        human_explanation=(
            f"Total tax payable for {fy} ({regime} regime, {statute}): ₹{total_tax} "
            f"= slab after rebate ₹{slab_tax_after_rebate} + flat-rate ₹{flat_rate_tax_total} "
            f"+ surcharge ₹{surcharge} + cess ₹{cess}."
        ),
    )

    tds = money(filing.tds_paid)
    balance = quantize(total_tax - tds)
    trace.step(
        op="balance",
        input={"total_tax": str(total_tax), "tds_paid": str(tds)},
        result=balance,
        human_explanation=(
            f"Balance = total tax ₹{total_tax} − TDS / prepaid ₹{tds} = ₹{balance}. "
            + ("Refund expected." if balance < ZERO else
               "Payable at filing via challan ITNS 280 (Section 140A — self-assessment).")
        ),
    )

    # Pin rule versions onto the trace for replay safety.
    trace.rule_versions = resolver.versions()

    trace_dict = trace.to_dict()
    trace_id = None
    if persist:
        row = CalculationTrace(
            filing_id=filing_id,
            regime=regime,
            trace_json=trace_dict,
            final_total=float(total_tax),
            rule_versions=trace.rule_versions,
            computed_by_user_id=filing.user_id,
        )
        db.add(row)
        db.flush()
        trace_id = row.id

    return TaxResult(
        regime=regime,
        fy=fy,
        statute=statute,
        gross_total_income=gti_normal,
        deductions=quantize(std_ded + chapter_via),
        taxable_income=taxable,
        slab_tax=slab_tax,
        rebate_87a=rebate,
        flat_rate_tax=flat_rate_tax_total,
        surcharge=surcharge,
        cess=cess,
        total_tax=total_tax,
        tds_paid=tds,
        balance_payable=balance,
        trace=trace_dict,
        trace_id=trace_id,
    )


def _declared_field(filing: TaxReturn, key: str) -> Any:
    if not filing.summary_json:
        return None
    return filing.summary_json.get(key)
