"""Section 87A rebate with marginal relief.

Resident individuals only. Applies only to slab tax on "normal" income — never on
flat-rate sections (§§111A, 112, 112A, 115BB). When taxable income is just above
the threshold, marginal relief caps the post-rebate tax at the income excess.
"""

from __future__ import annotations

from decimal import Decimal

from app.services.taxation.money import Money, ZERO, money, quantize
from app.services.taxation.rules import ResolvedRule
from app.services.taxation.trace import TraceBuilder


def apply_87a(
    *,
    taxable_normal: Money,
    slab_tax: Money,
    total_income_including_flat: Money,
    is_resident: bool,
    rule: ResolvedRule,
    trace: TraceBuilder,
) -> Money:
    threshold = money(rule.rule_json["threshold_income"])
    cap = money(rule.rule_json["rebate_cap"])
    has_marginal_relief = bool(rule.rule_json.get("marginal_relief", False))
    residents_only = bool(rule.rule_json.get("applies_to_residents_only", True))
    excludes_flat = bool(rule.rule_json.get("excludes_flat_rate_tax", True))

    if residents_only and not is_resident:
        trace.step(
            op="apply_rebate_87a",
            section_ref=rule.section_ref,
            rule_id=rule.rule_id,
            rule_version=rule.version,
            input={"taxable_normal": str(taxable_normal), "slab_tax": str(slab_tax)},
            result=ZERO,
            applied=False,
            reason="non_resident",
            human_explanation="Section 87A rebate is available only to resident individuals. Not applied.",
        )
        return ZERO

    # Eligibility test. Flat-rate income (CG, lottery) counts toward the
    # threshold even though the rebate only reduces slab tax. If flat income
    # alone pushes total over the threshold, the rebate is fully denied and
    # marginal relief cannot rescue it.
    total_for_test = total_income_including_flat if excludes_flat else taxable_normal
    flat_part = quantize(total_for_test - taxable_normal)

    if total_for_test > threshold and flat_part > ZERO:
        trace.step(
            op="apply_rebate_87a",
            section_ref=rule.section_ref,
            rule_id=rule.rule_id,
            rule_version=rule.version,
            input={
                "taxable_normal": str(taxable_normal),
                "total_income_for_eligibility": str(total_for_test),
                "threshold": str(threshold),
            },
            result=ZERO,
            applied=False,
            reason="total_income_exceeds_threshold_with_flat_rate_income",
            human_explanation=(
                f"Section 87A rebate not applied — total income (₹{total_for_test}) "
                f"exceeds the ₹{threshold} threshold once special-rate income "
                f"(capital gains etc.) of ₹{flat_part} is included. The rebate "
                f"requires total income within the threshold; marginal relief does "
                f"not apply when the excess comes from flat-rate income."
            ),
        )
        return ZERO

    # Pure slab case. Two sub-cases:
    #  (a) taxable_normal ≤ threshold → straight rebate, capped at cap and slab_tax.
    #  (b) taxable_normal > threshold AND marginal_relief enabled → relief caps
    #      post-rebate tax at (taxable_normal − threshold), so
    #      rebate = max(0, slab_tax − excess), still bounded by slab_tax.
    relief_applied = False
    if taxable_normal <= threshold:
        rebate = min(slab_tax, cap)
    elif has_marginal_relief:
        excess = quantize(taxable_normal - threshold)
        if slab_tax > excess:
            rebate = quantize(slab_tax - excess)
            relief_applied = True
        else:
            rebate = ZERO
    else:
        rebate = ZERO

    if rebate <= ZERO:
        trace.step(
            op="apply_rebate_87a",
            section_ref=rule.section_ref,
            rule_id=rule.rule_id,
            rule_version=rule.version,
            input={
                "taxable_normal": str(taxable_normal),
                "slab_tax": str(slab_tax),
                "threshold": str(threshold),
            },
            result=ZERO,
            applied=False,
            reason="taxable_income_exceeds_threshold",
            human_explanation=(
                f"Section 87A rebate not applied — taxable income (₹{taxable_normal}) "
                f"exceeds the ₹{threshold} threshold, and marginal relief does not "
                f"apply at this income level."
            ),
        )
        return ZERO

    trace.step(
        op="apply_rebate_87a",
        section_ref=rule.section_ref,
        rule_id=rule.rule_id,
        rule_version=rule.version,
        input={"taxable_normal": str(taxable_normal), "slab_tax": str(slab_tax)},
        result=rebate,
        applied=True,
        rebate_cap=str(cap),
        marginal_relief_applied=relief_applied,
        human_explanation=_explain_87a(taxable_normal, slab_tax, rebate, cap,
                                       threshold, relief_applied),
    )
    return rebate


def _explain_87a(taxable: Money, slab_tax: Money, rebate: Money, cap: Money,
                 threshold: Money, relief_applied: bool) -> str:
    if relief_applied:
        excess = quantize(taxable - threshold)
        return (
            f"Section 87A marginal relief applied. Without it, exceeding the ₹{threshold} "
            f"threshold by ₹{excess} would have eliminated the rebate entirely and cost "
            f"₹{slab_tax} in tax. Marginal relief caps post-rebate tax at ₹{excess} "
            f"(the income excess), so the rebate is ₹{rebate} and tax after rebate is "
            f"₹{quantize(slab_tax - rebate)}."
        )
    if rebate >= slab_tax:
        return (
            f"Section 87A rebate fully covers your slab tax. Your taxable income "
            f"(₹{taxable}) is within the ₹{threshold} threshold, so the rebate of "
            f"₹{rebate} (capped at ₹{cap}) reduces your tax to zero."
        )
    return (
        f"Section 87A rebate of ₹{rebate} applied (capped at ₹{cap}). Taxable income "
        f"₹{taxable} is within the ₹{threshold} threshold."
    )
