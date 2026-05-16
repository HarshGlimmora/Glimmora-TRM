"""Other Sources head — interest, dividend, lottery (§115BB).

Slab portion (most income — interest, dividends, family pension) flows into GTI.

Lottery / betting / crossword / race winnings under §115BB are taxed at flat 30%,
no basic exemption, no deduction. Surcharge on §115BB winnings is capped at 15%
(same Finance Act 2022 treatment as §§111A / 112 / 112A).

NOTE: Online gaming under §115BBJ (introduced FY 2023-24) is a parallel flat-30%
regime on NET winnings (withdrawal − deposits − opening balance). Full §115BBJ
support is deferred until per-platform deposit/withdrawal data is available
(MVP currently lacks the schema for it).
"""

from __future__ import annotations

from decimal import Decimal

from app.models.documents import Transaction
from app.services.taxation.money import Money, ZERO, money, quantize
from app.services.taxation.result import FlatRateBucket, HeadResult
from app.services.taxation.rules import RuleResolver, RuleNotFoundError
from app.services.taxation.trace import TraceBuilder

_LOTTERY_CATEGORIES = {
    "lottery_115bb", "lottery", "betting", "race_winnings", "crossword_winnings",
    "game_show_winnings", "gambling",
}
_SLAB_OS_CATEGORIES = {
    "interest_income", "interest_savings", "interest_fd",
    "dividend", "family_pension", "other_income",
}


def compute_head_other_sources(
    txns: list[Transaction],
    *,
    resolver: RuleResolver,
    trace: TraceBuilder,
) -> HeadResult:
    slab_total = ZERO
    lottery_total = ZERO
    slab_breakdown: list[dict] = []

    for tx in txns:
        cat = (tx.category or "").lower()
        amount = money(tx.amount)
        if cat in _LOTTERY_CATEGORIES:
            lottery_total = quantize(lottery_total + amount)
        elif cat in _SLAB_OS_CATEGORIES:
            slab_total = quantize(slab_total + amount)
            # Surface the bank / payer name (from 26AS Part A1 or bank
            # statement) rather than the bare category string.
            slab_breakdown.append({
                "label": tx.description or tx.counterparty or cat,
                "counterparty": tx.counterparty,
                "category": cat,
                "amount": str(amount),
                "txn_id": tx.id,
            })

    if slab_total > ZERO:
        trace.step(
            op="sum_head_other_sources_slab",
            section_ref="56-59",
            input={"transaction_count": len(slab_breakdown)},
            breakdown=slab_breakdown,
            result=slab_total,
            human_explanation=(
                f"Income from Other Sources (interest, dividends, family pension) "
                f"of ₹{slab_total} added to GTI at slab rates. Source: §§56–59 "
                f"of the Income Tax Act, 1961."
            ),
        )

    buckets: list[FlatRateBucket] = []
    if lottery_total > ZERO:
        rate, surcharge_cap = _lottery_rate(resolver)
        buckets.append(FlatRateBucket(
            section="lottery_115bb",
            taxable_amount=lottery_total,
            rate=rate,
            threshold=ZERO,
            surcharge_cap=surcharge_cap,
            label="Lottery / betting / race / crossword winnings",
        ))
        trace.step(
            op="route_lottery_flat",
            section_ref="115BB",
            input={"amount": str(lottery_total), "rate": str(rate)},
            result=lottery_total,
            human_explanation=(
                f"Lottery / betting / race winnings of ₹{lottery_total} routed to §115BB "
                f"flat-rate taxation @ {rate * 100:g}%. No basic exemption applies; "
                f"no deduction (Chapter VI-A or otherwise) is allowed; §87A rebate does "
                f"not apply. Surcharge on this income is independently capped at 15% "
                f"per Finance Act 2022."
            ),
        )

    return HeadResult(head="other_sources", slab_taxable=slab_total, flat_rate_buckets=buckets)


def _lottery_rate(resolver: RuleResolver) -> tuple[Decimal, Decimal | None]:
    try:
        rule = resolver.get("flat_rate_lottery_115bb")
        rj = rule.rule_json
        return (
            Decimal(str(rj["rate"])),
            Decimal(str(rj["surcharge_cap"])) if rj.get("surcharge_cap") else None,
        )
    except RuleNotFoundError:
        # §115BB: 30% flat; surcharge on this income is capped at 15% (FA 2022).
        return (Decimal("0.30"), Decimal("0.15"))
