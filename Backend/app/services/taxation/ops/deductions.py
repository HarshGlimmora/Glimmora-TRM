"""Deduction pipeline.

MVP scope:
  - Standard deduction (§16(ia)) — auto-applied for salaried filers.
  - §80C with shared cap across 80CCC + 80CCD(1).
  - §80CCD(1B) additional NPS.
  - §80D health insurance.
  - §80TTA savings-interest.

All Chapter VI-A deductions are gated to the old regime via the `regimes` field
on the rule. Declared amounts come from `tax_returns.summary_json["declared_deductions"]`
which the user/CA fills during transaction review.
"""

from __future__ import annotations

from app.services.taxation.money import Money, ZERO, money, quantize
from app.services.taxation.rules import RuleResolver, RuleNotFoundError
from app.services.taxation.trace import TraceBuilder


def apply_standard_deduction(
    *,
    salary_income: Money,
    regime: str,
    resolver: RuleResolver,
    trace: TraceBuilder,
) -> Money:
    rule_type = f"standard_deduction_{regime}_regime"
    try:
        rule = resolver.get(rule_type)
    except RuleNotFoundError:
        return ZERO

    if salary_income <= ZERO:
        return ZERO

    amount = money(rule.rule_json["amount"])
    deduction = min(amount, salary_income)

    trace.step(
        op="apply_standard_deduction",
        section_ref=rule.section_ref,
        rule_id=rule.rule_id,
        rule_version=rule.version,
        input=str(salary_income),
        result=deduction,
        human_explanation=(
            f"Standard deduction of ₹{deduction} applied under §{rule.section_ref} "
            f"({'new' if regime == 'new' else 'old'} regime cap ₹{amount}). "
            f"Source: {rule.source_reference}."
        ),
    )
    return deduction


def apply_chapter_via(
    *,
    gti: Money,
    regime: str,
    declared: dict[str, float | int | str],
    resolver: RuleResolver,
    trace: TraceBuilder,
) -> Money:
    """Walk the declared Chapter VI-A deductions and apply caps. Old regime only."""
    if regime != "old":
        trace.step(
            op="apply_chapter_via",
            section_ref="VI-A",
            input={"regime": regime},
            result=ZERO,
            human_explanation=(
                "Chapter VI-A deductions (80C, 80D, etc.) are disallowed under the "
                "new regime — Section 115BAC. Skipped."
            ),
        )
        return ZERO

    total = ZERO

    # 80C + 80CCC + 80CCD(1) — single ₹1.5L shared cap.
    eighty_c_declared = (
        money(declared.get("80c", 0)) +
        money(declared.get("80ccc", 0)) +
        money(declared.get("80ccd_1", 0))
    )
    if eighty_c_declared > ZERO:
        rule = resolver.get("deduction_80c")
        cap = money(rule.rule_json["cap"])
        applied = min(eighty_c_declared, cap)
        total = quantize(total + applied)
        trace.step(
            op="apply_deduction_80c",
            section_ref=rule.section_ref,
            rule_id=rule.rule_id,
            rule_version=rule.version,
            input={"declared": str(eighty_c_declared), "cap": str(cap)},
            result=applied,
            human_explanation=(
                f"Section 80C (with shared cap covering 80CCC + 80CCD(1)) applied: "
                f"₹{applied} against the ₹{cap} cap. "
                f"You declared ₹{eighty_c_declared}; anything over the cap is disallowed."
            ),
        )

    # 80CCD(1B) — additional ₹50k NPS, over and above the 80C cap.
    nps_extra = money(declared.get("80ccd_1b", 0))
    if nps_extra > ZERO:
        rule = resolver.get("deduction_80ccd_1b")
        cap = money(rule.rule_json["cap"])
        applied = min(nps_extra, cap)
        total = quantize(total + applied)
        trace.step(
            op="apply_deduction_80ccd_1b",
            section_ref=rule.section_ref,
            rule_id=rule.rule_id,
            rule_version=rule.version,
            input={"declared": str(nps_extra), "cap": str(cap)},
            result=applied,
            human_explanation=(
                f"Section 80CCD(1B) — additional NPS contribution of ₹{applied} "
                f"(cap ₹{cap}). This is over and above the §80C ₹1.5L cap."
            ),
        )

    # 80D — health insurance.
    d_80d = money(declared.get("80d", 0))
    if d_80d > ZERO:
        rule = resolver.get("deduction_80d")
        cap = money(rule.rule_json.get("cap_self_family_under60", 25000))
        applied = min(d_80d, cap)
        total = quantize(total + applied)
        trace.step(
            op="apply_deduction_80d",
            section_ref=rule.section_ref,
            rule_id=rule.rule_id,
            rule_version=rule.version,
            input={"declared": str(d_80d), "cap": str(cap)},
            result=applied,
            human_explanation=(
                f"Section 80D — health insurance premium deduction of ₹{applied} "
                f"applied (cap ₹{cap} for self+family under 60)."
            ),
        )

    # 80TTA — savings interest, capped ₹10k.
    d_80tta = money(declared.get("80tta", 0))
    if d_80tta > ZERO:
        rule = resolver.get("deduction_80tta")
        cap = money(rule.rule_json["cap"])
        applied = min(d_80tta, cap)
        total = quantize(total + applied)
        trace.step(
            op="apply_deduction_80tta",
            section_ref=rule.section_ref,
            rule_id=rule.rule_id,
            rule_version=rule.version,
            input={"declared": str(d_80tta), "cap": str(cap)},
            result=applied,
            human_explanation=(
                f"Section 80TTA — savings-account interest deduction of ₹{applied} "
                f"applied (cap ₹{cap})."
            ),
        )

    # Cannot reduce GTI below zero.
    if total > gti:
        total = gti

    trace.step(
        op="aggregate_chapter_via",
        section_ref="VI-A",
        input={"sections_considered": ["80C", "80CCD(1B)", "80D", "80TTA"]},
        result=total,
        human_explanation=(
            f"Total Chapter VI-A deductions applied: ₹{total}. These reduce your "
            f"Gross Total Income to arrive at Total (Taxable) Income."
        ),
    )
    return total
