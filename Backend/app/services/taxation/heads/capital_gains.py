"""Capital gains head — routes transactions into slab-taxable vs flat-rate buckets.

Buckets per current law (FY 2025-26, Finance Act 2024 effective 23 Jul 2024):
  • §111A — STCG on listed equity (STT paid)    → 20% flat
  • §112A — LTCG on listed equity (STT paid)    → 12.5% above ₹1.25L exempt
  • §112  — LTCG on other long-term assets       → 12.5% without indexation
  • All other STCG (debt MF, gold, non-equity)   → slab rate (added to GTI)

MVP: classification is by transaction `category` (e.g. "stcg_111a"). Future:
per-transaction `asset_class` + `holding_period` + `stt_paid` + `acquisition_date`
to support the §112 grandfather (immovable property pre-23-Jul-2024) computation.
"""

from __future__ import annotations

from decimal import Decimal

from app.models.documents import Transaction
from app.services.taxation.money import Money, ZERO, money, quantize
from app.services.taxation.result import FlatRateBucket, HeadResult
from app.services.taxation.rules import RuleResolver, RuleNotFoundError
from app.services.taxation.trace import TraceBuilder


_FLAT_RATE_CATEGORIES = {
    "stcg_111a": ("stcg_111a", "STCG on listed equity (STT paid)"),
    "ltcg_112a": ("ltcg_112a", "LTCG on listed equity (STT paid)"),
    "ltcg_112":  ("ltcg_112",  "LTCG on other long-term assets"),
}
# Categories that land in slab-taxable capital gains (added to GTI):
_SLAB_CG_CATEGORIES = {"stcg_other", "stcg_debt", "stcg_gold", "stcg_property_short"}


def compute_head_capital_gains(
    txns: list[Transaction],
    *,
    resolver: RuleResolver,
    trace: TraceBuilder,
) -> HeadResult:
    bucket_amounts: dict[str, Money] = {}
    slab_cg = ZERO

    for tx in txns:
        cat = (tx.category or "").lower()
        amount = money(tx.amount)
        if cat in _FLAT_RATE_CATEGORIES:
            key, _label = _FLAT_RATE_CATEGORIES[cat]
            bucket_amounts[key] = quantize(bucket_amounts.get(key, ZERO) + amount)
        elif cat in _SLAB_CG_CATEGORIES:
            slab_cg = quantize(slab_cg + amount)

    if not bucket_amounts and slab_cg == ZERO:
        return HeadResult(head="capital_gains")

    buckets: list[FlatRateBucket] = []
    for section, total in bucket_amounts.items():
        if total <= ZERO:
            continue
        rate, threshold, surcharge_cap = _rate_threshold(section, resolver)
        _label = _FLAT_RATE_CATEGORIES[section][1]
        buckets.append(FlatRateBucket(
            section=section,
            taxable_amount=total,
            rate=rate,
            threshold=threshold,
            surcharge_cap=surcharge_cap,
            label=_label,
        ))

    if slab_cg > ZERO:
        trace.step(
            op="sum_head_capital_gains_slab",
            section_ref="45-55A",
            input={"amount": str(slab_cg)},
            result=slab_cg,
            human_explanation=(
                f"Slab-taxable capital gains (non-equity STCG, etc.) of ₹{slab_cg} "
                f"flows into GTI and is taxed at slab rates."
            ),
        )

    if buckets:
        trace.step(
            op="route_capital_gains_flat",
            section_ref="45-55A",
            input={
                "buckets": [
                    {"section": b.section, "amount": str(b.taxable_amount),
                     "rate": str(b.rate), "exempt": str(b.threshold)}
                    for b in buckets
                ]
            },
            result=quantize(sum((b.taxable_amount for b in buckets), ZERO)),
            human_explanation=(
                "Capital gains routed to flat-rate (special) sections — these bypass "
                "the slab tax and the §87A rebate, and have their own surcharge caps."
            ),
        )

    return HeadResult(head="capital_gains", slab_taxable=slab_cg, flat_rate_buckets=buckets)


def _rate_threshold(section: str, resolver: RuleResolver) -> tuple[Decimal, Money, Decimal | None]:
    try:
        rule = resolver.get(f"flat_rate_{section}")
        rj = rule.rule_json
        return (
            Decimal(str(rj["rate"])),
            money(rj.get("threshold", 0)),
            Decimal(str(rj["surcharge_cap"])) if rj.get("surcharge_cap") else None,
        )
    except RuleNotFoundError:
        # Hard-coded fallback (logged elsewhere). Engine still produces a trace.
        fallback = {
            "stcg_111a": (Decimal("0.20"),   ZERO,                Decimal("0.15")),
            "ltcg_112a": (Decimal("0.125"),  money(125000),       Decimal("0.15")),
            "ltcg_112":  (Decimal("0.125"),  ZERO,                Decimal("0.15")),
        }
        return fallback.get(section, (Decimal("0"), ZERO, None))
