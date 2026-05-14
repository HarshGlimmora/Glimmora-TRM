"""Flat-rate (special-rate) tax computation.

Handles §§111A, 112, 112A, 115BB. Each bucket is taxed at its own rate,
independent of slab. Section 87A rebate does NOT apply to flat-rate tax
(handled by the rebate op excluding flat income from total-for-test). Surcharge
on flat-rate income is independently capped at 15% per Finance Act 2022.
"""

from __future__ import annotations

from app.services.taxation.money import Money, ZERO, quantize
from app.services.taxation.result import FlatRateBucket
from app.services.taxation.rules import RuleResolver, RuleNotFoundError
from app.services.taxation.trace import TraceBuilder


def apply_flat_rate(
    bucket: FlatRateBucket,
    *,
    resolver: RuleResolver,
    trace: TraceBuilder,
) -> Money:
    """Compute tax on one flat-rate bucket. Returns the tax amount."""
    section_after_exemption = quantize(bucket.taxable_amount - bucket.threshold)
    if section_after_exemption < ZERO:
        section_after_exemption = ZERO

    tax = quantize(section_after_exemption * bucket.rate)

    rule_id: str | None = None
    rule_version: int | None = None
    source_reference: str = ""
    try:
        rule = resolver.get(f"flat_rate_{bucket.section}")
        rule_id = rule.rule_id
        rule_version = rule.version
        source_reference = rule.source_reference
    except RuleNotFoundError:
        pass

    trace.step(
        op="flat_rate_tax",
        section_ref=_section_label(bucket.section),
        rule_id=rule_id,
        rule_version=rule_version,
        input={
            "gross_amount": str(bucket.taxable_amount),
            "exempt_threshold": str(bucket.threshold),
            "taxable_after_exemption": str(section_after_exemption),
            "rate": str(bucket.rate),
        },
        result=tax,
        bucket_label=bucket.label,
        surcharge_cap=str(bucket.surcharge_cap) if bucket.surcharge_cap else None,
        human_explanation=_explain(bucket, section_after_exemption, tax, source_reference),
    )
    return tax


def _section_label(symbol: str) -> str:
    return {
        "stcg_111a":     "111A",
        "ltcg_112":      "112",
        "ltcg_112a":     "112A",
        "lottery_115bb": "115BB",
    }.get(symbol, symbol)


def _explain(bucket: FlatRateBucket, taxable: Money, tax: Money, source: str) -> str:
    rate_pct = bucket.rate * 100
    if bucket.threshold > ZERO:
        return (
            f"§{_section_label(bucket.section)}: {bucket.label or bucket.section} "
            f"of ₹{bucket.taxable_amount} taxed at {rate_pct:g}% on amount above the "
            f"₹{bucket.threshold} exemption. Taxable: ₹{taxable}. Tax: ₹{tax}. "
            f"This bucket is NOT eligible for §87A rebate. "
            + (f"Source: {source}." if source else "")
        )
    return (
        f"§{_section_label(bucket.section)}: {bucket.label or bucket.section} "
        f"of ₹{bucket.taxable_amount} taxed at flat {rate_pct:g}% — no slab, no §87A. "
        f"Tax: ₹{tax}. "
        + (f"Source: {source}." if source else "")
    )
