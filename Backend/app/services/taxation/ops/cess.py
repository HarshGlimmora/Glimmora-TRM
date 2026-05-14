"""Health and Education Cess @ 4% (Finance Act 2018, unchanged since)."""

from __future__ import annotations

from decimal import Decimal

from app.services.taxation.money import Money, money, quantize
from app.services.taxation.rules import ResolvedRule
from app.services.taxation.trace import TraceBuilder


def apply_cess(
    *,
    tax_plus_surcharge: Money,
    rule: ResolvedRule,
    trace: TraceBuilder,
) -> Money:
    rate = Decimal(str(rule.rule_json["rate"]))
    cess = quantize(tax_plus_surcharge * rate)

    trace.step(
        op="apply_cess",
        section_ref=rule.section_ref,
        rule_id=rule.rule_id,
        rule_version=rule.version,
        input=str(tax_plus_surcharge),
        rate=str(rate),
        result=cess,
        human_explanation=(
            f"Health and Education Cess @ {rate * 100:g}% applied on (tax + surcharge) "
            f"of ₹{tax_plus_surcharge}. Cess: ₹{cess}. "
            f"Source: {rule.source_reference}."
        ),
    )
    return cess
