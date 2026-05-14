"""Surcharge with mathematically exact marginal relief.

Surcharge applies to (slab-after-rebate + flat-rate tax). It kicks in when total
income crosses ₹50L. Marginal relief at each threshold (50L, 1Cr, 2Cr, 5Cr)
ensures continuity: the *increase* in tax+surcharge cannot exceed the *increase*
in income above the threshold.

Special-rate income (§111A, §112, §112A, §115BB) carries its own surcharge cap
(15% per Finance Act 2022). The surcharge on the slab portion uses the regime's
normal band rate; the surcharge on each flat-rate bucket uses min(band rate, cap).

  Formula (continuous):
    let tax_at_threshold = slab_tax_at(threshold)   (rebate is 0 at high income)
    let surcharge_normal = tax_for_surcharge × rate_at(income)
    let cap_amount       = (income − threshold) − (tax_for_surcharge − tax_at_threshold)
    surcharge            = min(surcharge_normal, max(0, cap_amount))
"""

from __future__ import annotations

from decimal import Decimal

from app.services.taxation.money import Money, ZERO, money, quantize
from app.services.taxation.ops.slab import compute_slab_pure
from app.services.taxation.result import FlatRateBucket
from app.services.taxation.rules import ResolvedRule
from app.services.taxation.trace import TraceBuilder


def apply_surcharge(
    *,
    total_income: Money,
    slab_tax_after_rebate: Money,
    flat_rate_buckets: list[FlatRateBucket],
    flat_rate_taxes: list[Money],
    slab_rule_for_threshold: ResolvedRule,
    surcharge_rule: ResolvedRule,
    trace: TraceBuilder,
) -> Money:
    """Compute total surcharge across slab tax and flat-rate buckets."""
    bands = surcharge_rule.rule_json["bands"]
    has_marginal_relief = bool(surcharge_rule.rule_json.get("marginal_relief", False))

    rate, threshold = _band_rate(total_income, bands)

    if rate == Decimal("0"):
        trace.step(
            op="apply_surcharge",
            section_ref=surcharge_rule.section_ref,
            rule_id=surcharge_rule.rule_id,
            rule_version=surcharge_rule.version,
            input={
                "total_income": str(total_income),
                "slab_tax_after_rebate": str(slab_tax_after_rebate),
                "flat_rate_tax_components": [str(t) for t in flat_rate_taxes],
            },
            result=ZERO,
            applied_rate="0",
            reason="income_below_first_threshold",
            human_explanation=(
                f"No surcharge — total income ₹{total_income} is below the first "
                f"surcharge threshold of ₹{money(bands[0]['from_income'])}."
            ),
        )
        return ZERO

    # Surcharge on slab tax — use regime rate.
    surcharge_on_slab = quantize(slab_tax_after_rebate * rate)

    # Surcharge on each flat-rate bucket — capped per bucket.
    surcharge_on_flat = ZERO
    flat_breakdown: list[dict] = []
    for bucket, flat_tax in zip(flat_rate_buckets, flat_rate_taxes):
        applied_rate = rate
        capped = False
        if bucket.surcharge_cap is not None and rate > bucket.surcharge_cap:
            applied_rate = bucket.surcharge_cap
            capped = True
        sur = quantize(flat_tax * applied_rate)
        surcharge_on_flat = quantize(surcharge_on_flat + sur)
        flat_breakdown.append({
            "section":      bucket.section,
            "flat_tax":     str(flat_tax),
            "applied_rate": str(applied_rate),
            "surcharge":    str(sur),
            "capped":       capped,
        })

    surcharge_normal = quantize(surcharge_on_slab + surcharge_on_flat)

    # Marginal relief — exact: compute tax at the threshold using the same slab
    # rule, then cap the surcharge increase at the income increase. This relief
    # is conceptually applied to the slab portion only (flat-rate income already
    # has its own surcharge cap), so the math uses slab_tax_after_rebate alone
    # at the threshold for comparison.
    relief_applied = False
    relief_detail: dict | None = None
    if has_marginal_relief and threshold is not None:
        income_excess = quantize(total_income - threshold)
        slab_tax_at_threshold, _ = compute_slab_pure(threshold, slab_rule_for_threshold)
        # At the threshold, rebate is 0 for any income > ₹12L (new) or ₹5L (old),
        # both far below ₹50L. So slab_tax_at_threshold = slab_tax_after_rebate at threshold.
        slab_tax_delta = quantize(slab_tax_after_rebate - slab_tax_at_threshold)
        max_combined_increase = income_excess
        # The "extra" surcharge crossing the threshold should not push (slab_tax_delta + surcharge_on_slab)
        # above the income excess.
        cap_for_slab_surcharge = quantize(max_combined_increase - slab_tax_delta)
        if cap_for_slab_surcharge < ZERO:
            cap_for_slab_surcharge = ZERO

        if surcharge_on_slab > cap_for_slab_surcharge:
            new_surcharge_on_slab = cap_for_slab_surcharge
            relief_applied = True
            relief_detail = {
                "threshold":                  str(threshold),
                "income_excess":              str(income_excess),
                "slab_tax_at_threshold":      str(slab_tax_at_threshold),
                "slab_tax_delta":             str(slab_tax_delta),
                "surcharge_on_slab_normal":   str(surcharge_on_slab),
                "surcharge_on_slab_capped":   str(new_surcharge_on_slab),
            }
            surcharge_on_slab = new_surcharge_on_slab
            surcharge_normal = quantize(surcharge_on_slab + surcharge_on_flat)

    trace.step(
        op="apply_surcharge",
        section_ref=surcharge_rule.section_ref,
        rule_id=surcharge_rule.rule_id,
        rule_version=surcharge_rule.version,
        input={
            "total_income":            str(total_income),
            "slab_tax_after_rebate":   str(slab_tax_after_rebate),
            "flat_rate_components":    flat_breakdown,
            "band_rate":               str(rate),
            "threshold":               str(threshold) if threshold is not None else None,
        },
        result=surcharge_normal,
        applied_rate=str(rate),
        surcharge_on_slab=str(surcharge_on_slab),
        surcharge_on_flat=str(surcharge_on_flat),
        marginal_relief_applied=relief_applied,
        marginal_relief_detail=relief_detail,
        human_explanation=_explain(
            total_income, slab_tax_after_rebate, rate, surcharge_on_slab,
            surcharge_on_flat, flat_breakdown, relief_applied, relief_detail,
        ),
    )
    return surcharge_normal


def _band_rate(income: Money, bands: list[dict]) -> tuple[Decimal, Money | None]:
    for b in bands:
        lo = money(b["from_income"])
        hi_raw = b.get("to_income")
        hi = money(hi_raw) if hi_raw is not None else None
        if income > lo and (hi is None or income <= hi):
            return Decimal(str(b["rate"])), lo
    return Decimal("0"), None


def _explain(income: Money, slab_tax: Money, rate: Decimal,
             surcharge_on_slab: Money, surcharge_on_flat: Money,
             flat_breakdown: list[dict], relief_applied: bool,
             relief_detail: dict | None) -> str:
    rate_pct = rate * 100
    lines = [f"Surcharge band: {rate_pct:g}% applies above ₹50,00,000 (total income ₹{income})."]
    lines.append(f"  • On slab tax ₹{slab_tax}: surcharge = ₹{surcharge_on_slab}")
    if flat_breakdown:
        for fb in flat_breakdown:
            tag = " (15% cap on special-rate income)" if fb["capped"] else ""
            lines.append(
                f"  • On §{fb['section']} flat tax ₹{fb['flat_tax']} @ "
                f"{Decimal(fb['applied_rate']) * 100:g}%{tag}: ₹{fb['surcharge']}"
            )
    if relief_applied and relief_detail:
        lines.append(
            f"  Marginal relief applied: without relief, crossing ₹{relief_detail['threshold']} "
            f"by ₹{relief_detail['income_excess']} would have raised tax+surcharge by more than "
            f"the income excess. Surcharge on slab tax reduced from "
            f"₹{relief_detail['surcharge_on_slab_normal']} to "
            f"₹{relief_detail['surcharge_on_slab_capped']}."
        )
    lines.append(f"Total surcharge: ₹{quantize(surcharge_on_slab + surcharge_on_flat)}.")
    return "\n".join(lines)
